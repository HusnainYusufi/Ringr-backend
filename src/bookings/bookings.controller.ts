import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { Tenant, BookingStatus } from '@prisma/client';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  findAll(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: BookingStatus,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    return this.bookingsService.findAll(tenant.id, user, {
      cursor, limit, from, to, status, order,
    });
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingsService.findOne(id, tenant.id, user);
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingsService.cancel(id, tenant.id, user);
  }

  @Patch(':id/complete')
  complete(
    @Param('id') id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingsService.complete(id, tenant.id, user);
  }

  @Patch(':id/no-show')
  markNoShow(
    @Param('id') id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingsService.markNoShow(id, tenant.id, user);
  }
}
