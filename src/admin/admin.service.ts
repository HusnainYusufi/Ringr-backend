import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GeoService } from '../geo/geo.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BillingService } from '../billing/billing.service';
import {
  CreateTenantDto,
  UpdateTenantDto,
  CreateVerticalDto,
  CreateTenantAdminDto,
} from './dto/create-tenant.dto';
import { OnboardProviderDto } from './dto/onboard-provider.dto';
import { Role } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly billing: BillingService,
  ) {}

  // ─── Verticals ────────────────────────────────────────────────────────────

  async listVerticals() {
    return this.prisma.vertical.findMany({ orderBy: { name: 'asc' } });
  }

  async createVertical(dto: CreateVerticalDto) {
    const existing = await this.prisma.vertical.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('A vertical with this slug already exists');

    return this.prisma.vertical.create({ data: dto });
  }

  async updateVertical(id: string, config: Record<string, any>) {
    const vertical = await this.prisma.vertical.findUnique({ where: { id } });
    if (!vertical) throw new NotFoundException('Vertical not found');
    return this.prisma.vertical.update({ where: { id }, data: { config } });
  }

  // ─── Tenants ──────────────────────────────────────────────────────────────

  async listTenants() {
    return this.prisma.tenant.findMany({
      include: { vertical: true, _count: { select: { providers: true, customers: true, bookings: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        vertical: true,
        providers: { where: { isDeleted: false }, select: { id: true, name: true, city: true, isActive: true } },
        retellAgents: true,
        _count: { select: { customers: true, bookings: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async createTenant(dto: CreateTenantDto) {
    const slugExists = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (slugExists) throw new ConflictException('Slug already taken');

    const subdomainExists = await this.prisma.tenant.findUnique({ where: { subdomain: dto.subdomain } });
    if (subdomainExists) throw new ConflictException('Subdomain already taken');

    const vertical = await this.prisma.vertical.findUnique({ where: { id: dto.verticalId } });
    if (!vertical) throw new NotFoundException('Vertical not found');

    // Generate a unique API key
    const apiKey = `rng-${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    return this.prisma.tenant.create({
      data: { ...dto, apiKey },
      include: { vertical: true },
    });
  }

  async updateTenant(id: string, dto: UpdateTenantDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  async rotateTenantApiKey(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const apiKey = `rng-${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    return this.prisma.tenant.update({ where: { id }, data: { apiKey } });
  }

  async registerRetellAgent(tenantId: string, agentId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    return this.prisma.retellAgent.upsert({
      where: { agentId },
      update: { tenantId },
      create: { agentId, tenantId },
    });
  }

  // ─── Tenant admin accounts ─────────────────────────────────────────────────

  async createTenantAdmin(tenantId: string, providerId: string, dto: CreateTenantAdminDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const exists = await this.prisma.providerStaff.findFirst({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const staff = await this.prisma.providerStaff.create({
      data: {
        tenantId,
        providerId,
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: 'TENANT_ADMIN',
      },
    });

    const { passwordHash: _, ...safe } = staff;
    return safe;
  }

  // ─── Provider onboarding (single-shot) ────────────────────────────────────

  /**
   * SUPER_ADMIN clicks "onboard new vet" in the portal. We:
   *   1. Geocode the address if lat/lng weren't supplied.
   *   2. In one transaction: create the Provider + a PROVIDER_OWNER staff
   *      record (placeholder password) + a single-use MagicLink token.
   *   3. Email the owner a link to set their password.
   *
   * If the email fails we still keep the records — the SUPER_ADMIN can resend
   * the invite. Better to have an orphaned invite than a half-created provider.
   */
  async onboardProvider(dto: OnboardProviderDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const vertical = await this.prisma.vertical.findUnique({ where: { id: dto.verticalId } });
    if (!vertical) throw new NotFoundException('Vertical not found');

    const existingOwner = await this.prisma.providerStaff.findFirst({
      where: { email: dto.ownerEmail, isDeleted: false },
    });
    if (existingOwner) throw new ConflictException('Owner email already in use');

    let lat = dto.lat;
    let lng = dto.lng;
    if (lat == null || lng == null) {
      const coords = await this.geo.geocodePostalCode(dto.postalCode);
      lat = coords.lat;
      lng = coords.lng;
    }

    // Placeholder password — guaranteed non-loginable (random 64-byte hex, hashed).
    // The owner sets a real password via the magic-link flow.
    const placeholder = crypto.randomBytes(64).toString('hex');
    const placeholderHash = await bcrypt.hash(placeholder, 12);

    const token = crypto.randomBytes(32).toString('hex'); // 64-char hex, CSPRNG
    const expirySeconds = this.config.get<number>('magicLink.expirySeconds');
    const expiresAt = new Date(Date.now() + expirySeconds * 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      const provider = await tx.provider.create({
        data: {
          tenantId: dto.tenantId,
          verticalId: dto.verticalId,
          name: dto.name,
          address: dto.address,
          city: dto.city,
          province: dto.province ?? 'ON',
          postalCode: dto.postalCode,
          lat: lat!,
          lng: lng!,
          phone: dto.phone,
          email: dto.email,
          bio: dto.bio,
        },
      });

      const owner = await tx.providerStaff.create({
        data: {
          tenantId: dto.tenantId,
          providerId: provider.id,
          email: dto.ownerEmail,
          passwordHash: placeholderHash,
          firstName: dto.ownerFirstName,
          lastName: dto.ownerLastName,
          role: Role.PROVIDER_OWNER,
          // Owner can't log in until they accept the invite. The accept flow
          // flips this to true.
          isActive: false,
        },
      });

      const magicLink = await tx.magicLink.create({
        data: {
          token,
          tenantId: dto.tenantId,
          staffId: owner.id,
          email: dto.ownerEmail,
          purpose: 'ONBOARDING',
          expiresAt,
        },
      });

      return { provider, owner, magicLink };
    });

    // Create the billing record (idempotent) so the provider's first completed
    // booking can find it.
    await this.billing.ensureBilling(result.provider.id, dto.tenantId);

    // Email outside the transaction — never let a flaky email API roll back the DB.
    await this.sendInviteEmail(result.owner, result.provider.name, token, expiresAt);

    const { passwordHash: _, ...safeOwner } = result.owner;
    return {
      provider: result.provider,
      owner: safeOwner,
      invite: {
        token, // exposed once so portal can copy a fallback link; never returned again
        expiresAt,
      },
    };
  }

  /** Regenerate a magic link for an already-onboarded but never-accepted owner. */
  async resendProviderInvite(staffId: string) {
    const staff = await this.prisma.providerStaff.findUnique({
      where: { id: staffId },
      include: { provider: true },
    });
    if (!staff) throw new NotFoundException('Staff not found');
    if (staff.isActive) {
      throw new ConflictException('Owner has already accepted their invite');
    }

    // Revoke any outstanding links so only the newest one works.
    await this.prisma.magicLink.updateMany({
      where: { staffId, consumedAt: null },
      data: { consumedAt: new Date() }, // burn them
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expirySeconds = this.config.get<number>('magicLink.expirySeconds');
    const expiresAt = new Date(Date.now() + expirySeconds * 1000);

    await this.prisma.magicLink.create({
      data: {
        token,
        tenantId: staff.tenantId,
        staffId: staff.id,
        email: staff.email,
        purpose: 'ONBOARDING',
        expiresAt,
      },
    });

    await this.sendInviteEmail(staff, staff.provider.name, token, expiresAt);

    return { sent: true, expiresAt };
  }

  private async sendInviteEmail(
    owner: { email: string; firstName: string },
    providerName: string,
    token: string,
    expiresAt: Date,
  ) {
    const portalBase = this.config.get<string>('portal.baseUrl');
    const acceptPath = this.config.get<string>('portal.inviteAcceptPath');
    const magicLinkUrl = `${portalBase}${acceptPath}?token=${token}`;

    const { subject, html } = this.notifications.buildOnboardingMagicLinkEmail({
      providerName,
      ownerFirstName: owner.firstName,
      magicLinkUrl,
      expiresAt,
    });

    try {
      await this.notifications.sendEmail({ to: owner.email, subject, html });
    } catch (err) {
      // Don't roll back the onboarding — just surface this for ops.
      this.logger.error(
        `Failed to send onboarding email to ${owner.email}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ─── Platform stats ────────────────────────────────────────────────────────

  async getPlatformStats() {
    const [tenantCount, providerCount, customerCount, bookingCount] = await Promise.all([
      this.prisma.tenant.count({ where: { isActive: true } }),
      this.prisma.provider.count({ where: { isDeleted: false } }),
      this.prisma.customer.count({ where: { isDeleted: false } }),
      this.prisma.booking.count({ where: { isDeleted: false } }),
    ]);

    return { tenantCount, providerCount, customerCount, bookingCount };
  }
}
