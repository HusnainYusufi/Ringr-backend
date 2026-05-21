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
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { StaffLoginDto } from './dto/staff-login.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { Tenant } from '@prisma/client';
import { InjectRedis } from '../redis/redis.decorator';
import type Redis from 'ioredis';

@Controller('auth')
@UseInterceptors(TenantInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @Public()
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() dto: SendOtpDto, @CurrentTenant() tenant: Tenant) {
    return this.authService.sendOtp(dto.phone, tenant, this.redis);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyOtp(dto.phone, dto.code, tenant, this.redis);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/v1/auth',
    });

    return {
      accessToken: result.accessToken,
      isNewCustomer: result.isNewCustomer,
    };
  }

  @Public()
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  async staffLogin(
    @Body() dto: StaffLoginDto,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.staffLogin(dto.email, dto.password, tenant);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });

    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @CurrentTenant() tenant: Tenant) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return { error: 'No refresh token' };
    }
    return this.authService.refresh(refreshToken, tenant);
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
}
