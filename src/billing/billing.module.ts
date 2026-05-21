import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController, AdminBillingController } from './billing.controller';

@Module({
  controllers: [BillingController, AdminBillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
