import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { StaffLoginDto } from './dto/staff-login.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { SkipTenant } from '../tenant/skip-tenant.decorator';
import { Tenant } from '@prisma/client';
import { InjectRedis } from '../redis/redis.decorator';
import type Redis from 'ioredis';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/api/v1/auth',
};

@Controller('auth')
@UseInterceptors(TenantInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @Public()
  @Throttle({ short: { limit: 3, ttl: 60_000 }, long: { limit: 10, ttl: 60 * 60_000 } })
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() dto: SendOtpDto, @CurrentTenant() tenant: Tenant) {
    return this.authService.sendOtp(dto.phone, tenant, this.redis);
  }

  @Public()
  @Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 20, ttl: 60 * 60_000 } })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyOtp(dto.phone, dto.code, tenant, this.redis);

    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

    return {
      accessToken: result.accessToken,
      isNewCustomer: result.isNewCustomer,
    };
  }

  @Public()
  @Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 20, ttl: 60 * 60_000 } })
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  async staffLogin(
    @Body() dto: StaffLoginDto,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.staffLogin(dto.email, dto.password, tenant);

    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token');
    }
    const result = await this.authService.refresh(refreshToken, tenant);

    // Refresh tokens are rotated on every use — re-set the cookie so the client
    // sends the new one next time. The old token is now revoked.
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

    return { accessToken: result.accessToken };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    return { loggedOut: true };
  }

  // ─── Accept magic-link invite ─────────────────────────────────────────────
  //
  // Owner clicks the email link → portal POSTs token + new password here.
  // No tenant header is required: the tenant is resolved from the token
  // record itself. Bypass the tenant interceptor for this single route.
  @Public()
  @SkipTenant()
  @Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 20, ttl: 60 * 60_000 } })
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.acceptInvite(dto.token, dto.password);

    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

    return { accessToken: result.accessToken };
  }
}
