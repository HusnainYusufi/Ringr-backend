import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  CreateTenantDto,
  UpdateTenantDto,
  CreateVerticalDto,
  CreateTenantAdminDto,
} from './dto/create-tenant.dto';
import { OnboardProviderDto } from './dto/onboard-provider.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantBypassInterceptor } from '../tenant/tenant-bypass.interceptor';
import { Role } from '@prisma/client';

// SUPER_ADMIN operates across all tenants. TenantBypassInterceptor sets the
// AsyncLocalStorage bypass flag so the Prisma tenant middleware doesn't reject
// the cross-tenant queries.

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@UseInterceptors(TenantBypassInterceptor)
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

  // ─── Provider onboarding (marketplace flow) ────────────────────────────────

  // Single-shot: create Provider + PROVIDER_OWNER + magic-link invite email.
  @Post('providers/onboard')
  onboardProvider(@Body() dto: OnboardProviderDto) {
    return this.adminService.onboardProvider(dto);
  }

  // Generate a fresh magic link for an owner who hasn't accepted yet.
  @Post('providers/staff/:staffId/resend-invite')
  resendProviderInvite(@Param('staffId') staffId: string) {
    return this.adminService.resendProviderInvite(staffId);
  }
}
