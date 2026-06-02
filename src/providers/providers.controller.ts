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
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  ReplaceWeekScheduleDto,
} from './dto/schedule.dto';
import { CreateBlackoutDto } from './dto/blackout.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
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

  // ─── "Me" routes — declared BEFORE :id so /me isn't matched as an id ──────
  // (Nest matches in declaration order for the same HTTP method.)

  @Get('me')
  @Roles(Role.PROVIDER_OWNER, Role.PROVIDER_STAFF)
  findMyProvider(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: Tenant) {
    return this.providersService.findMyProvider(user, tenant.id);
  }

  @Get('me/dashboard')
  @Roles(Role.PROVIDER_OWNER, Role.PROVIDER_STAFF)
  myDashboard(@CurrentUser() user: JwtPayload, @CurrentTenant() tenant: Tenant) {
    return this.providersService.myDashboard(user, tenant.id);
  }

  @Patch('me')
  @Roles(Role.PROVIDER_OWNER)
  updateMyProvider(
    @CurrentUser() user: JwtPayload,
    @Body() dto: Partial<CreateProviderDto>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.updateMyProvider(user, dto, tenant.id);
  }

  @Post('me/complete-setup')
  @Roles(Role.PROVIDER_OWNER)
  completeSetup(
    @CurrentUser() user: JwtPayload,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.completeSetup(user, tenant.id);
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

  // ─── Schedule CRUD ───────────────────────────────────────────────────────

  @Get(':id/schedules')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.PROVIDER_STAFF, Role.SUPER_ADMIN)
  listSchedules(@Param('id') id: string, @CurrentTenant() tenant: Tenant) {
    return this.providersService.listSchedules(id, tenant.id);
  }

  @Post(':id/schedules')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  createSchedule(
    @Param('id') id: string,
    @Body() dto: CreateScheduleDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.createSchedule(id, dto, tenant.id);
  }

  @Patch(':id/schedules/:scheduleId')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  updateSchedule(
    @Param('id') id: string,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.updateSchedule(id, scheduleId, dto, tenant.id);
  }

  @Delete(':id/schedules/:scheduleId')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  deleteSchedule(
    @Param('id') id: string,
    @Param('scheduleId') scheduleId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.deleteSchedule(id, scheduleId, tenant.id);
  }

  // Convenience endpoint for the portal "set opening hours" page — replaces
  // the entire weekly schedule in one transaction.
  @Post(':id/schedules/replace-week')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  replaceWeekSchedule(
    @Param('id') id: string,
    @Body() dto: ReplaceWeekScheduleDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.replaceWeekSchedule(id, dto, tenant.id);
  }

  // ─── Blackouts (vacation / closures) ─────────────────────────────────────

  @Get(':id/blackouts')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.PROVIDER_STAFF, Role.SUPER_ADMIN)
  listBlackouts(@Param('id') id: string, @CurrentTenant() tenant: Tenant) {
    return this.providersService.listBlackouts(id, tenant.id);
  }

  @Post(':id/blackouts')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  createBlackout(
    @Param('id') id: string,
    @Body() dto: CreateBlackoutDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.createBlackout(id, dto, tenant.id);
  }

  @Delete(':id/blackouts/:blackoutId')
  @Roles(Role.TENANT_ADMIN, Role.PROVIDER_OWNER, Role.SUPER_ADMIN)
  deleteBlackout(
    @Param('id') id: string,
    @Param('blackoutId') blackoutId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.providersService.deleteBlackout(id, blackoutId, tenant.id);
  }
}
