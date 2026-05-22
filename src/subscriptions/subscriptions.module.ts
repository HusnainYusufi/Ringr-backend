import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { AdminSubscriptionsController } from './subscriptions.controller';

@Module({
  controllers: [AdminSubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
