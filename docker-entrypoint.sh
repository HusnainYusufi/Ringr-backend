#!/bin/sh
# Container startup: apply migrations, optionally seed, then exec the API.
#
# Env knobs:
#   RUN_MIGRATIONS  default "true"  — set to "false" to skip prisma migrate deploy
#   RUN_SEEDS       default "false" — set to "true" to seed (idempotent upserts in seed.ts)
#   WAIT_FOR_DB     default "true"  — set to "false" to skip Postgres reachability probe
#
# Anything passed after the entrypoint is exec'd as the main process so SIGTERM
# from `docker stop` reaches node directly (via tini) and we get a graceful shutdown.

set -e

log() { echo "[entrypoint] $*"; }

# ── 1. Wait for Postgres to be reachable ────────────────────────────────────
# Avoids the classic "migrate failed because the DB wasn't up yet" race on first boot.
if [ "${WAIT_FOR_DB:-true}" = "true" ] && [ -n "$DATABASE_URL" ]; then
  log "Waiting for database to accept connections..."
  # Parse host:port from DATABASE_URL via node (already in the image).
  HOST_PORT=$(node -e "
    const u = new URL(process.env.DATABASE_URL);
    process.stdout.write(u.hostname + ':' + (u.port || 5432));
  ")
  HOST=${HOST_PORT%:*}
  PORT=${HOST_PORT#*:}

  i=0
  until node -e "require('net').createConnection({host:'$HOST',port:$PORT}).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; do
    i=$((i + 1))
    if [ $i -ge 30 ]; then
      log "Database at $HOST:$PORT unreachable after 30 attempts — giving up."
      exit 1
    fi
    sleep 1
  done
  log "Database reachable at $HOST:$PORT."
fi

# ── 2. Apply migrations ─────────────────────────────────────────────────────
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  log "Applying Prisma migrations..."
  npx prisma migrate deploy
else
  log "RUN_MIGRATIONS=false — skipping migrations."
fi

# ── 3. Seed (opt-in) ────────────────────────────────────────────────────────
# Never default-on. Seeding production by accident is a foot-gun. The seed
# script uses upserts so re-running is safe, but it's still gated.
if [ "${RUN_SEEDS:-false}" = "true" ]; then
  log "Seeding database..."
  npx prisma db seed
else
  log "RUN_SEEDS=false — skipping seed."
fi

# ── 4. Hand off to the main process ─────────────────────────────────────────
log "Starting Ringr API..."
exec "$@"
