-- DropForeignKey
ALTER TABLE "BillingLedgerEntry" DROP CONSTRAINT "BillingLedgerEntry_billingId_fkey";

-- DropForeignKey
ALTER TABLE "MagicLink" DROP CONSTRAINT "MagicLink_staffId_fkey";

-- DropForeignKey
ALTER TABLE "ProviderApiKey" DROP CONSTRAINT "ProviderApiKey_providerId_fkey";

-- DropForeignKey
ALTER TABLE "ProviderBilling" DROP CONSTRAINT "ProviderBilling_providerId_fkey";

-- DropForeignKey
ALTER TABLE "ProviderBlackout" DROP CONSTRAINT "ProviderBlackout_providerId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_providerId_fkey";

-- DropForeignKey
ALTER TABLE "WebhookEndpoint" DROP CONSTRAINT "WebhookEndpoint_providerId_fkey";

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "isSetupComplete" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionLog_tenantId_idx" ON "ActionLog"("tenantId");

-- CreateIndex
CREATE INDEX "ActionLog_createdAt_idx" ON "ActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActionLog_actorId_idx" ON "ActionLog"("actorId");

-- CreateIndex
CREATE INDEX "ActionLog_action_idx" ON "ActionLog"("action");

-- AddForeignKey
ALTER TABLE "ProviderBlackout" ADD CONSTRAINT "ProviderBlackout_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MagicLink" ADD CONSTRAINT "MagicLink_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "ProviderStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderBilling" ADD CONSTRAINT "ProviderBilling_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLedgerEntry" ADD CONSTRAINT "BillingLedgerEntry_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "ProviderBilling"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderApiKey" ADD CONSTRAINT "ProviderApiKey_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderApiKey" ADD CONSTRAINT "ProviderApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
