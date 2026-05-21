import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  CreateTenantDto,
  UpdateTenantDto,
  CreateVerticalDto,
  CreateTenantAdminDto,
} from './dto/create-tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

// The admin portal authenticates using the SUPER_ADMIN JWT directly.
// No TenantInterceptor here — SUPER_ADMIN operates across all tenants.

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Platform stats ───────────────────────────────────────────────────────

  @Get('stats')
  getPlatformStats() {
    return this.adminService.getPlatformStats();
  }

  // ─── Verticals ────────────────────────────────────────────────────────────

  @Get('verticals')
  listVerticals() {
    return this.adminService.listVerticals();
  }

  @Post('verticals')
  createVertical(@Body() dto: CreateVerticalDto) {
    return this.adminService.createVertical(dto);
  }

  @Patch('verticals/:id/config')
  updateVerticalConfig(@Param('id') id: string, @Body() config: Record<string, any>) {
    return this.adminService.updateVertical(id, config);
  }

  // ─── Tenants ──────────────────────────────────────────────────────────────

  @Get('tenants')
  listTenants() {
    return this.adminService.listTenants();
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.adminService.getTenant(id);
  }

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.adminService.createTenant(dto);
  }

  @Patch('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.adminService.updateTenant(id, dto);
  }

  @Post('tenants/:id/rotate-api-key')
  rotateTenantApiKey(@Param('id') id: string) {
    return this.adminService.rotateTenantApiKey(id);
  }

  @Post('tenants/:id/retell-agents')
  registerRetellAgent(@Param('id') id: string, @Body('agentId') agentId: string) {
    return this.adminService.registerRetellAgent(id, agentId);
  }

  @Post('tenants/:tenantId/providers/:providerId/admins')
  createTenantAdmin(
    @Param('tenantId') tenantId: string,
    @Param('providerId') providerId: string,
    @Body() dto: CreateTenantAdminDto,
  ) {
    return this.adminService.createTenantAdmin(tenantId, providerId, dto);
  }
}
