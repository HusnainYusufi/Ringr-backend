-- DropForeignKey
ALTER TABLE "CallSession" DROP CONSTRAINT "CallSession_tenantId_fkey";

-- DropIndex
DROP INDEX "CallSession_tenantId_fromPhone_idx";

-- AlterTable
ALTER TABLE "CallSession" ALTER COLUMN "tenantId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CallSession_callId_idx" ON "CallSession"("callId");

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
