import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminAuthController } from './admin-auth.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GeoModule } from '../geo/geo.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [AuthModule, NotificationsModule, GeoModule, BillingModule],
  controllers: [AdminController, AdminAuthController],
  providers: [AdminService],
})
export class AdminModule {}
