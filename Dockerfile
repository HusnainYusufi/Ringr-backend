# syntax=docker/dockerfile:1.7
#
# Ringr backend — multi-stage build.
#
# Build-time gates (fail the image if any of them break):
#   1. prisma generate
#   2. npm run lint
#   3. tsc --noEmit
#   4. nest build
#   5. compile prisma/seed.ts so it's runnable without ts-node
#
# Runtime image runs prisma migrate deploy on boot, optionally seeds when
# RUN_SEEDS=true, then execs node dist/main.

ARG NODE_VERSION=20-alpine

# ─── deps ─────────────────────────────────────────────────────────────────────
# Cached dependency layer. Re-runs only when package*.json changes.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Native build toolchain for bcrypt
RUN apk add --no-cache python3 make g++ libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ─── builder ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client first — lint/typecheck both import @prisma/client types.
RUN npx prisma generate

# Quality gates. Any of these failing aborts the image build.
RUN npm run lint
RUN npx tsc --noEmit
RUN npm run build

# Compile the seed script so the runtime image doesn't need ts-node.
# Outputs to dist/prisma/seed.js (preserves the prisma/ subdir).
RUN npx tsc prisma/seed.ts \
      --outDir dist \
      --target ES2021 \
      --module commonjs \
      --esModuleInterop \
      --skipLibCheck \
      --resolveJsonModule

# Prune dev dependencies in place — we'll copy node_modules into the runtime stage.
RUN npm prune --omit=dev

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# openssl: prisma engines need it. tini: PID 1 signal forwarder so SIGTERM
# reaches node and we get a graceful shutdown.
RUN apk add --no-cache openssl tini

# Copy production node_modules (pruned) and compiled output.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Drop root.
RUN addgroup -S app && adduser -S app -G app \
 && chown -R app:app /app
USER app

EXPOSE 3000

# Liveness check: the global prefix is /api/v1 so an unmapped route returns 404,
# but a healthy server still answers — anything < 500 means the process is alive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/main"]
