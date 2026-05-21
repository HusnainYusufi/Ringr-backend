import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { TenantBypassInterceptor } from '../tenant/tenant-bypass.interceptor';
import { BillingService, AdjustBillingDto } from './billing.service';
import { Role } from '@prisma/client';

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // ── PROVIDER: my billing summary ──
  @Get('me')
  @Roles(Role.PROVIDER_OWNER, Role.PROVIDER_STAFF)
  myBilling(@CurrentUser() user: JwtPayload) {
    if (!user.providerId) throw new NotFoundException('No provider attached to this account');
    return this.billing.getProviderBilling(user.providerId);
  }

  // ── PROVIDER: my ledger (history) ──
  @Get('me/ledger')
  @Roles(Role.PROVIDER_OWNER, Role.PROVIDER_STAFF)
  myLedger(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    if (!user.providerId) throw new NotFoundException('No provider attached to this account');
    return this.billing.listLedgerEntries(user.providerId, { cursor, limit });
  }
}

/**
 * SUPER_ADMIN endpoints. Mounted separately because they bypass tenant
 * scoping — billing is one of the cross-tenant views SUPER_ADMIN owns.
 */
@Controller('admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@UseInterceptors(TenantBypassInterceptor)
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  listAll() {
    return this.billing.listAllBilling();
  }

  @Get(':providerId')
  one(@Param('providerId') providerId: string) {
    return this.billing.getProviderBilling(providerId);
  }

  @Get(':providerId/ledger')
  ledger(
    @Param('providerId') providerId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.billing.listLedgerEntries(providerId, { cursor, limit });
  }

  @Patch(':providerId')
  adjust(@Param('providerId') providerId: string, @Body() dto: AdjustBillingDto) {
    return this.billing.adjustBilling(providerId, dto);
  }
}
