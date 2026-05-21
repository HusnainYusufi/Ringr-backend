-- ProviderBlackout: date ranges when a provider is unavailable (vacation,
-- holidays, equipment outage). The slot generator skips dates inside a
-- blackout, and creating a blackout flips existing AVAILABLE slots in the
-- range to BLOCKED.
CREATE TABLE "ProviderBlackout" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  -- [startsAt, endsAt) — endsAt is exclusive.
  "startsAt"   TIMESTAMP(3) NOT NULL,
  "endsAt"     TIMESTAMP(3) NOT NULL,
  "reason"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderBlackout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderBlackout_tenantId_providerId_idx" ON "ProviderBlackout"("tenantId", "providerId");
CREATE INDEX "ProviderBlackout_providerId_startsAt_endsAt_idx" ON "ProviderBlackout"("providerId", "startsAt", "endsAt");

ALTER TABLE "ProviderBlackout"
  ADD CONSTRAINT "ProviderBlackout_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderBlackout"
  ADD CONSTRAINT "ProviderBlackout_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
