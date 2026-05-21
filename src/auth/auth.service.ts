import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { Tenant, Role } from '@prisma/client';

// We use a plain ioredis client for OTP/cache — not through PrismaService
// This is injected via a simple Redis provider in AuthModule

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ─── OTP ──────────────────────────────────────────────────────────────────

  async sendOtp(phone: string, tenant: Tenant, redis: Redis): Promise<{ sent: boolean }> {
    const demoMode = this.config.get<boolean>('demoMode');

    const otp = demoMode ? '123456' : this.generateOtp();
    const key = this.otpKey(tenant.id, phone);

    await redis.set(key, otp, 'EX', 300); // 5-minute TTL

    if (!demoMode) {
      await this.sendSms(phone, `Your Ringr code is: ${otp}`);
    } else {
      this.logger.debug(`[DEMO] OTP for ${phone}: ${otp}`);
    }

    return { sent: true };
  }

  async verifyOtp(
    phone: string,
    code: string,
    tenant: Tenant,
    redis: Redis,
  ): Promise<{ accessToken: string; refreshToken: string; isNewCustomer: boolean }> {
    const demoMode = this.config.get<boolean>('demoMode');
    const key = this.otpKey(tenant.id, phone);

    if (!demoMode) {
      const stored = await redis.get(key);
      if (!stored || stored !== code) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      // Single-use: delete immediately after verification
      await redis.del(key);
    }

    // Upsert customer — first-time callers are registered automatically
    let customer = await this.prisma.customer.findFirst({
      where: { phone, isDeleted: false },
    });

    const isNewCustomer = !customer;
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: { phone, tenantId: tenant.id },
      });
    }

    return this.issueTokens(
      { sub: customer.id, tenantId: tenant.id, role: Role.CUSTOMER, type: 'customer' },
      customer.id,
      null,
      tenant.id,
    ).then(async (tokens) => ({ ...tokens, isNewCustomer }));
  }

  // ─── Staff login ───────────────────────────────────────────────────────────

  async staffLogin(
    email: string,
    password: string,
    tenant: Tenant,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const staff = await this.prisma.providerStaff.findFirst({
      where: { email, isDeleted: false, isActive: true },
    });

    if (!staff) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, staff.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(
      {
        sub: staff.id,
        tenantId: tenant.id,
        role: staff.role,
        providerId: staff.providerId,
        type: 'staff',
      },
      null,
      staff.id,
      tenant.id,
    );
  }

  // ─── Refresh ───────────────────────────────────────────────────────────────

  async refresh(
    refreshToken: string,
    tenant: Tenant,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const stored = await this.prisma.refreshToken.findFirst({
      where: { token: refreshToken, revokedAt: null },
      include: { customer: true, staff: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    let payload: JwtPayload;
    if (stored.customerId) {
      payload = {
        sub: stored.customerId,
        tenantId: tenant.id,
        role: Role.CUSTOMER,
        type: 'customer',
      };
    } else {
      const staff = stored.staff!;
      payload = {
        sub: staff.id,
        tenantId: tenant.id,
        role: staff.role,
        providerId: staff.providerId,
        type: 'staff',
      };
    }

    // Rotate: revoke the presented token and issue a fresh pair atomically.
    // Without rotation a stolen refresh token is valid for the full 7d window.
    const [, tokens] = await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          token: uuidv4(),
          tenantId: tenant.id,
          customerId: stored.customerId,
          staffId: stored.staffId,
          expiresAt: this.refreshTokenExpiry(),
        },
      }),
    ]);

    return {
      accessToken: this.signAccessToken(payload),
      refreshToken: tokens.token,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revokedAt: new Date() },
    });
  }

  // ─── Accept magic-link invite ──────────────────────────────────────────────

  /**
   * Provider owner clicks the email link, lands on /accept-invite, posts
   * { token, password }. We validate the token, set the staff password,
   * activate the account, and issue tokens so they're logged straight into
   * the dashboard.
   */
  async acceptInvite(
    token: string,
    newPassword: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const link = await this.prisma.magicLink.findUnique({
      where: { token },
      include: { staff: true },
    });

    if (!link || link.consumedAt || link.expiresAt < new Date()) {
      throw new UnauthorizedException('Invite is invalid or expired');
    }
    if (!link.staff) {
      // FK guarantee — but the type is nullable. Defensive.
      throw new UnauthorizedException('Invite is invalid');
    }
    if (link.staff.isDeleted) {
      throw new UnauthorizedException('Invite is invalid');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atomic: set password, mark staff active, burn the token.
    const [updatedStaff] = await this.prisma.$transaction([
      this.prisma.providerStaff.update({
        where: { id: link.staffId },
        data: { passwordHash, isActive: true },
      }),
      this.prisma.magicLink.update({
        where: { id: link.id },
        data: { consumedAt: new Date() },
      }),
      // Burn any other outstanding invites for this staff member.
      this.prisma.magicLink.updateMany({
        where: { staffId: link.staffId, consumedAt: null, id: { not: link.id } },
        data: { consumedAt: new Date() },
      }),
    ]);

    return this.issueTokens(
      {
        sub: updatedStaff.id,
        tenantId: updatedStaff.tenantId,
        role: updatedStaff.role,
        providerId: updatedStaff.providerId,
        type: 'staff',
      },
      null,
      updatedStaff.id,
      updatedStaff.tenantId,
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async issueTokens(
    payload: JwtPayload,
    customerId: string | null,
    staffId: string | null,
    tenantId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.signAccessToken(payload);

    const refreshTokenValue = uuidv4();

    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        tenantId,
        customerId,
        staffId,
        expiresAt: this.refreshTokenExpiry(),
      },
    });

    return { accessToken, refreshToken: refreshTokenValue };
  }

  private refreshTokenExpiry(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }

  private signAccessToken(payload: JwtPayload): string {
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
    });
  }

  private generateOtp(): string {
    // crypto.randomInt is uniformly distributed and CSPRNG-backed; Math.random is neither.
    return String(crypto.randomInt(100000, 1000000));
  }

  private otpKey(tenantId: string, phone: string): string {
    return `otp:${tenantId}:${phone}`;
  }

  private async sendSms(to: string, body: string): Promise<void> {
    const accountSid = this.config.get<string>('twilio.accountSid');
    const authToken = this.config.get<string>('twilio.authToken');
    const from = this.config.get<string>('twilio.fromNumber');

    if (!accountSid || !authToken) {
      this.logger.warn('Twilio credentials not configured');
      return;
    }

    const twilio = require('twilio')(accountSid, authToken);
    await twilio.messages.create({ to, from, body });
  }
}
