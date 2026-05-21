import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { GenerateSlotsDto } from './dto/generate-slots.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { Tenant, Role, SlotStatus } from '@prisma/client';

@Controller('providers')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get()
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.PROVIDER_STAFF, Role.SUPER_ADMIN)
  findAll(@CurrentTenant() tenant: Tenant) {
    return this.providersService.findAll(tenant.id);
  }

  @Post()
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  create(@Body() dto: CreateProviderDto, @CurrentTenant() tenant: Tenant) {
    return this.providersService.create(dto, tenant.id);
  }

  @Get(':id')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.PROVIDER_STAFF, Role.SUPER_ADMIN)
  findOne(@Param('id') id: string, @CurrentTenant() tenant: Tenant) {
    return this.providersService.findOne(id, tenant.id);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateProviderDto>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.update(id, dto, tenant.id);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  remove(@Param('id') id: string, @CurrentTenant() tenant: Tenant) {
    return this.providersService.softDelete(id, tenant.id);
  }

  // ─── Slots ───────────────────────────────────────────────────────────────

  @Get(':id/slots')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.PROVIDER_STAFF, Role.SUPER_ADMIN)
  getSlots(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('status') status: SlotStatus,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.getSlots(id, tenant.id, from, to, status);
  }

  @Post(':id/slots/generate')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  generateSlots(
    @Param('id') id: string,
    @Body() dto: GenerateSlotsDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.generateSlots(id, dto, tenant.id);
  }

  @Patch(':id/slots/:slotId')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.PROVIDER_STAFF, Role.SUPER_ADMIN)
  updateSlot(
    @Param('id') providerId: string,
    @Param('slotId') slotId: string,
    @Body('status') status: SlotStatus,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.updateSlot(providerId, slotId, status, tenant.id);
  }
}
