-- One billing record per provider. Created at onboarding time. First
-- `freeQuota` completed bookings are free; subsequent bookings accrue
-- `chargePerBookingCents`. Updates happen on the booking.completed event.
CREATE TABLE "ProviderBilling" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "providerId"            TEXT NOT NULL,
  "freeQuota"             INTEGER NOT NULL DEFAULT 20,
  "freeBookingsUsed"      INTEGER NOT NULL DEFAULT 0,
  "paidBookingsCount"     INTEGER NOT NULL DEFAULT 0,
  "chargePerBookingCents" INTEGER NOT NULL DEFAULT 500,
  "totalChargedCents"     INTEGER NOT NULL DEFAULT 0,
  "lastChargedAt"         TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProviderBilling_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderBilling_providerId_key" ON "ProviderBilling"("providerId");
CREATE INDEX "ProviderBilling_tenantId_idx" ON "ProviderBilling"("tenantId");

ALTER TABLE "ProviderBilling"
  ADD CONSTRAINT "ProviderBilling_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderBilling"
  ADD CONSTRAINT "ProviderBilling_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One ledger entry per booking event. The unique constraint on bookingId is
-- our double-charge guard if the booking.completed event ever fires twice.
CREATE TABLE "BillingLedgerEntry" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "providerId"  TEXT NOT NULL,
  "billingId"   TEXT NOT NULL,
  "bookingId"   TEXT NOT NULL,
  "type"        TEXT NOT NULL, -- FREE | CHARGE | CREDIT | ADJUSTMENT
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BillingLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingLedgerEntry_bookingId_key" ON "BillingLedgerEntry"("bookingId");
CREATE INDEX "BillingLedgerEntry_tenantId_providerId_idx"
  ON "BillingLedgerEntry"("tenantId", "providerId");
CREATE INDEX "BillingLedgerEntry_providerId_createdAt_idx"
  ON "BillingLedgerEntry"("providerId", "createdAt");

ALTER TABLE "BillingLedgerEntry"
  ADD CONSTRAINT "BillingLedgerEntry_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingLedgerEntry"
  ADD CONSTRAINT "BillingLedgerEntry_billingId_fkey"
  FOREIGN KEY ("billingId") REFERENCES "ProviderBilling"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
