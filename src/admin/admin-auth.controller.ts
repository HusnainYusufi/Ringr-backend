import {
  Controller,
  Post,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { IsEmail, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { TenantBypassInterceptor } from '../tenant/tenant-bypass.interceptor';
import { Role } from '@prisma/client';

class AdminLoginDto {
  @IsEmail()
  email: string;
  @IsString()
  password: string;
}

// SUPER_ADMIN login does NOT go through TenantInterceptor.
// It reads from the PlatformAdmin table (or a staff record with SUPER_ADMIN role).
// For simplicity: SUPER_ADMIN is a ProviderStaff with role=SUPER_ADMIN and no providerId constraint.

@Controller('admin/auth')
@UseInterceptors(TenantBypassInterceptor)
export class AdminAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ short: { limit: 3, ttl: 60_000 }, long: { limit: 10, ttl: 60 * 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AdminLoginDto, @Res({ passthrough: true }) res: Response) {
    // Look for a SUPER_ADMIN staff account across any tenant
    const admin = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM "ProviderStaff"
      WHERE email = ${dto.email}
        AND role = 'SUPER_ADMIN'
        AND "isDeleted" = false
        AND "isActive" = true
      LIMIT 1
    `;

    if (!admin.length) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, admin[0].passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const payload = {
      sub: admin[0].id,
      tenantId: admin[0].tenantId,
      role: Role.SUPER_ADMIN,
      type: 'staff',
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
    });

    res.cookie('refreshToken', 'super-admin-session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/admin',
    });

    return {
      accessToken,
      role: Role.SUPER_ADMIN,
      name: `${admin[0].firstName} ${admin[0].lastName}`,
    };
  }
}
