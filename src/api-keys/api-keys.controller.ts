import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { TenantBypassInterceptor } from '../tenant/tenant-bypass.interceptor';
import { ApiKeysService } from './api-keys.service';
import { Role } from '@prisma/client';

class CreateApiKeyDto {
  @IsString() @MinLength(1) @MaxLength(80)
  name: string;
}

/**
 * Provider-side API key management. PROVIDER_OWNER manages their own.
 */
@Controller('providers/me/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PROVIDER_OWNER)
@UseInterceptors(TenantInterceptor)
export class MyApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    if (!user.providerId) throw new NotFoundException('No provider attached');
    return this.apiKeys.listForProvider(user.providerId);
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateApiKeyDto) {
    if (!user.providerId) throw new NotFoundException('No provider attached');
    return this.apiKeys.issueKey(user.providerId, user.tenantId, dto.name);
  }

  @Delete(':keyId')
  revoke(@CurrentUser() user: JwtPayload, @Param('keyId') keyId: string) {
    if (!user.providerId) throw new NotFoundException('No provider attached');
    return this.apiKeys.revoke(user.providerId, keyId);
  }
}

/**
 * SUPER_ADMIN-side API key management. Can issue/revoke keys on behalf of
 * any provider — useful for support cases ("vet lost their key, give them
 * a new one").
 */
@Controller('admin/providers/:providerId/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@UseInterceptors(TenantBypassInterceptor)
export class AdminApiKeysController {
  constructor(
    private readonly apiKeys: ApiKeysService,
  ) {}

  @Get()
  list(@Param('providerId') providerId: string) {
    return this.apiKeys.listForProvider(providerId);
  }

  @Post()
  async create(
    @Param('providerId') providerId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    // SUPER_ADMIN issuing a key needs the tenantId — look it up from the provider.
    // We do this via the apiKeys service since the controller doesn't have direct Prisma access.
    return this.apiKeys.issueKeyForProvider(providerId, dto.name);
  }

  @Delete(':keyId')
  revoke(
    @Param('providerId') providerId: string,
    @Param('keyId') keyId: string,
  ) {
    return this.apiKeys.revoke(providerId, keyId);
  }
}
