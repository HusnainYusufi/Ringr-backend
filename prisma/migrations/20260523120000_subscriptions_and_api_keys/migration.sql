-- Subscriptions, per-provider API keys, and outbound webhook plumbing.
-- The vendor-integration tier model: STARTER (API + webhooks) / PRO (+ portal).

CREATE TYPE "SubscriptionTier" AS ENUM ('STARTER', 'PRO');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'PAST_DUE');

-- ─── Subscription (one per provider) ───────────────────────────────────────
CREATE TABLE "Subscription" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "providerId"            TEXT NOT NULL,
  "tier"                  "SubscriptionTier"   NOT NULL DEFAULT 'STARTER',
  "status"                "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "stripeCustomerId"      TEXT,
  "stripeSubscriptionId"  TEXT,
  "currentPeriodEnd"      TIMESTAMP(3),
  "cancelledAt"           TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_providerId_key" ON "Subscription"("providerId");
CREATE INDEX "Subscription_tenantId_idx" ON "Subscription"("tenantId");
CREATE INDEX "Subscription_tier_idx" ON "Subscription"("tier");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ProviderApiKey ────────────────────────────────────────────────────────
-- Plaintext returned ONCE at issuance; we store SHA-256 + a display tail.
CREATE TABLE "ProviderApiKey" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "keyHash"    TEXT NOT NULL,
  "keyPrefix"  TEXT NOT NULL,
  "lastFour"   TEXT NOT NULL,
  "revokedAt"  TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderApiKey_keyHash_key" ON "ProviderApiKey"("keyHash");
CREATE INDEX "ProviderApiKey_providerId_idx" ON "ProviderApiKey"("providerId");
CREATE INDEX "ProviderApiKey_tenantId_idx" ON "ProviderApiKey"("tenantId");
CREATE INDEX "ProviderApiKey_keyPrefix_idx" ON "ProviderApiKey"("keyPrefix");

ALTER TABLE "ProviderApiKey"
  ADD CONSTRAINT "ProviderApiKey_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── WebhookEndpoint ───────────────────────────────────────────────────────
CREATE TABLE "WebhookEndpoint" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "events"     TEXT NOT NULL,
  "secret"     TEXT NOT NULL,
  "enabled"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookEndpoint_providerId_idx" ON "WebhookEndpoint"("providerId");
CREATE INDEX "WebhookEndpoint_tenantId_idx" ON "WebhookEndpoint"("tenantId");
CREATE INDEX "WebhookEndpoint_enabled_idx" ON "WebhookEndpoint"("enabled");

ALTER TABLE "WebhookEndpoint"
  ADD CONSTRAINT "WebhookEndpoint_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── WebhookDelivery (Phase 6b will populate this) ─────────────────────────
CREATE TABLE "WebhookDelivery" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "endpointId"   TEXT NOT NULL,
  "event"        TEXT NOT NULL,
  "resourceId"   TEXT NOT NULL,
  "payload"      JSONB NOT NULL,
  "responseCode" INTEGER,
  "responseBody" TEXT,
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "succeededAt"  TIMESTAMP(3),
  "failedAt"     TIMESTAMP(3),
  "nextRetryAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookDelivery_endpointId_event_resourceId_key"
  ON "WebhookDelivery"("endpointId", "event", "resourceId");
CREATE INDEX "WebhookDelivery_tenantId_idx" ON "WebhookDelivery"("tenantId");
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");
CREATE INDEX "WebhookDelivery_nextRetryAt_idx" ON "WebhookDelivery"("nextRetryAt");

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
