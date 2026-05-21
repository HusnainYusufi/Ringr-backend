-- Add verticalId to Provider (nullable; new providers must set it via the API)
ALTER TABLE "Provider" ADD COLUMN "verticalId" TEXT;

CREATE INDEX "Provider_verticalId_idx" ON "Provider"("verticalId");

ALTER TABLE "Provider"
  ADD CONSTRAINT "Provider_verticalId_fkey"
  FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Single-use, time-bound invitation tokens for provider-owner onboarding
-- (and later password reset).
CREATE TABLE "MagicLink" (
  "id"         TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "staffId"    TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "purpose"    TEXT NOT NULL DEFAULT 'ONBOARDING',
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MagicLink_token_key" ON "MagicLink"("token");
CREATE INDEX "MagicLink_token_idx"     ON "MagicLink"("token");
CREATE INDEX "MagicLink_staffId_idx"   ON "MagicLink"("staffId");
CREATE INDEX "MagicLink_tenantId_idx"  ON "MagicLink"("tenantId");

ALTER TABLE "MagicLink"
  ADD CONSTRAINT "MagicLink_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MagicLink"
  ADD CONSTRAINT "MagicLink_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "ProviderStaff"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
