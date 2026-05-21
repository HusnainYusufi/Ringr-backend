import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { CreateStaffDto, UpdateStaffDto, ResetStaffPasswordDto } from './dto/create-staff.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { Tenant, Role } from '@prisma/client';

@Controller('providers/:providerId/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  findAll(@Param('providerId') providerId: string, @CurrentTenant() tenant: Tenant) {
    return this.staffService.findAll(providerId, tenant.id);
  }

  @Post()
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  create(
    @Param('providerId') providerId: string,
    @Body() dto: CreateStaffDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffService.create(providerId, tenant.id, dto, user);
  }

  @Patch(':staffId')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  update(
    @Param('staffId') staffId: string,
    @Body() dto: UpdateStaffDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.staffService.update(staffId, tenant.id, dto);
  }

  @Patch(':staffId/reset-password')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  resetPassword(
    @Param('staffId') staffId: string,
    @Body() dto: ResetStaffPasswordDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.staffService.resetPassword(staffId, tenant.id, dto);
  }

  @Patch(':staffId/deactivate')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  deactivate(@Param('staffId') staffId: string, @CurrentTenant() tenant: Tenant) {
    return this.staffService.deactivate(staffId, tenant.id);
  }

  @Delete(':staffId')
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  remove(@Param('staffId') staffId: string, @CurrentTenant() tenant: Tenant) {
    return this.staffService.softDelete(staffId, tenant.id);
  }
}
