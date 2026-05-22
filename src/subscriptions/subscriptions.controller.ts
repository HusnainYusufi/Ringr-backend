import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsEnum, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantBypassInterceptor } from '../tenant/tenant-bypass.interceptor';
import { SubscriptionsService } from './subscriptions.service';
import { Role, SubscriptionStatus, SubscriptionTier } from '@prisma/client';

class ChangeTierDto {
  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;
}

class ListSubsQueryDto {
  @IsOptional()
  @IsEnum(SubscriptionTier)
  tier?: SubscriptionTier;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;
}

/**
 * SUPER_ADMIN cross-tenant subscription management. Tenant-bypass interceptor
 * lets us operate without a tenant context (these views are platform-wide).
 */
@Controller('admin/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@UseInterceptors(TenantBypassInterceptor)
export class AdminSubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get()
  list(@Query() q: ListSubsQueryDto) {
    return this.subs.listAll(q);
  }

  @Get(':providerId')
  one(@Param('providerId') providerId: string) {
    return this.subs.getForProvider(providerId);
  }

  @Patch(':providerId/tier')
  changeTier(@Param('providerId') providerId: string, @Body() dto: ChangeTierDto) {
    return this.subs.changeTier(providerId, dto.tier);
  }

  @Post(':providerId/cancel')
  cancel(@Param('providerId') providerId: string) {
    return this.subs.cancel(providerId);
  }

  @Post(':providerId/reactivate')
  reactivate(@Param('providerId') providerId: string) {
    return this.subs.reactivate(providerId);
  }
}
