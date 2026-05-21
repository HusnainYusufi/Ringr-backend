import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { Tenant, Role } from '@prisma/client';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
@Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.PROVIDER_STAFF, Role.SUPER_ADMIN)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  getOverview(@CurrentTenant() tenant: Tenant, @CurrentUser() user: JwtPayload) {
    return this.analyticsService.getOverview(tenant.id, user);
  }

  @Get('bookings')
  getBookingTrend(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Query('days') days: number,
  ) {
    return this.analyticsService.getBookingTrend(tenant.id, user, days || 30);
  }

  @Get('providers')
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  getProviderPerformance(@CurrentTenant() tenant: Tenant, @CurrentUser() user: JwtPayload) {
    return this.analyticsService.getProviderPerformance(tenant.id, user);
  }
}
