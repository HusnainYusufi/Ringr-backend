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
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import {
  CreateTenantDto,
  UpdateTenantDto,
  CreateVerticalDto,
  CreateTenantAdminDto,
} from './dto/create-tenant.dto';
import { OnboardProviderDto } from './dto/onboard-provider.dto';
import { Prisma, Role } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly billing: BillingService,
    private readonly subscriptions: SubscriptionsService,
    private readonly apiKeys: ApiKeysService,
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

    // Provision the subscription at the requested tier (defaults to STARTER).
    const subscription = await this.subscriptions.ensureSubscription(
      result.provider.id,
      dto.tenantId,
      dto.tier,
    );

    // Issue the provider's first API key. Plaintext is returned ONCE — surface
    // it to the SUPER_ADMIN so they can pass it to the vendor securely.
    const apiKey = await this.apiKeys.issueKey(
      result.provider.id,
      dto.tenantId,
      'Initial onboarding key',
    );

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
      subscription: {
        tier: subscription.tier,
        status: subscription.status,
      },
      apiKey: {
        // Full plaintext returned exactly once — SUPER_ADMIN copies and shares with the vendor.
        plaintext: apiKey.plaintext,
        keyPrefix: apiKey.keyPrefix,
        lastFour: apiKey.lastFour,
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

  // ─── SUPER_ADMIN unified dashboard ────────────────────────────────────────

  /**
   * Cross-tenant dashboard payload. One round-trip, everything the admin
   * landing page needs:
   *   - Totals (tenants, providers, customers, bookings, calls)
   *   - This-week counts + AI call → booking conversion rate
   *   - Revenue this month (sum of CHARGE ledger entries)
   *   - Recent activity (latest 10 calls, latest 10 bookings)
   *   - Top providers by bookings
   */
  async getAdminOverview() {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      tenantCount,
      activeProviders,
      totalCustomers,
      totalBookings,
      totalCalls,
      callsThisWeek,
      callsThisWeekWithBooking,
      bookingsThisWeek,
      completedThisWeek,
      pendingInvites,
      revenueAgg,
      recentCalls,
      recentBookings,
    ] = await this.prisma.$transaction([
      this.prisma.tenant.count({ where: { isActive: true } }),
      this.prisma.provider.count({ where: { isDeleted: false, isActive: true } }),
      this.prisma.customer.count({ where: { isDeleted: false } }),
      this.prisma.booking.count({ where: { isDeleted: false } }),
      this.prisma.callSession.count(),
      this.prisma.callSession.count({ where: { startedAt: { gte: startOfWeek } } }),
      this.prisma.callSession.count({
        where: { startedAt: { gte: startOfWeek }, bookingId: { not: null } },
      }),
      this.prisma.booking.count({
        where: { isDeleted: false, createdAt: { gte: startOfWeek } },
      }),
      this.prisma.booking.count({
        where: { status: 'COMPLETED', completedAt: { gte: startOfWeek } },
      }),
      this.prisma.magicLink.count({
        where: {
          purpose: 'ONBOARDING',
          consumedAt: null,
          expiresAt: { gte: new Date() },
        },
      }),
      this.prisma.billingLedgerEntry.aggregate({
        where: { type: 'CHARGE', createdAt: { gte: startOfMonth } },
        _sum: { amountCents: true },
      }),
      this.prisma.callSession.findMany({
        take: 10,
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          callId: true,
          fromPhone: true,
          startedAt: true,
          endedAt: true,
          durationMs: true,
          bookingId: true,
        },
      }),
      this.prisma.booking.findMany({
        take: 10,
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          customer: { select: { name: true, phone: true } },
          provider: { select: { id: true, name: true } },
          slot: { select: { startsAt: true } },
        },
      }),
    ]);

    // groupBy can't live inside $transaction without tripping Prisma's TS
    // circular-type bug. Run it separately; consistency tradeoff is fine
    // (read-only dashboard, no FK dependence).
    const topProvidersRaw = await this.prisma.booking.groupBy({
      by: ['providerId'],
      where: { isDeleted: false, createdAt: { gte: startOfMonth } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    // Resolve provider names for the top-providers list.
    const topProviderIds = topProvidersRaw.map((p) => p.providerId);
    const topProviderNames = topProviderIds.length
      ? await this.prisma.provider.findMany({
          where: { id: { in: topProviderIds } },
          select: { id: true, name: true, city: true },
        })
      : [];
    const topProviders = topProvidersRaw.map((row) => ({
      ...topProviderNames.find((p) => p.id === row.providerId),
      bookingCount: row._count.id,
    }));

    const conversionRate =
      callsThisWeek > 0 ? callsThisWeekWithBooking / callsThisWeek : 0;

    return {
      totals: {
        tenants: tenantCount,
        activeProviders,
        customers: totalCustomers,
        bookings: totalBookings,
        calls: totalCalls,
        pendingInvites,
      },
      thisWeek: {
        calls: callsThisWeek,
        bookings: bookingsThisWeek,
        completed: completedThisWeek,
        callsConverted: callsThisWeekWithBooking,
        conversionRate,
      },
      revenue: {
        monthChargedCents: revenueAgg._sum.amountCents ?? 0,
      },
      recentCalls,
      recentBookings,
      topProviders,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Paginated call-session list across all providers. */
  async listCalls(opts: {
    cursor?: string;
    limit?: number;
    fromPhone?: string;
    hasBooking?: 'true' | 'false';
  }) {
    const limit = Math.min(opts.limit ?? 25, 100);
    const where: Prisma.CallSessionWhereInput = {};
    if (opts.cursor) where.id = { lt: opts.cursor };
    if (opts.fromPhone) where.fromPhone = { contains: opts.fromPhone };
    if (opts.hasBooking === 'true') where.bookingId = { not: null };
    if (opts.hasBooking === 'false') where.bookingId = null;

    const calls = await this.prisma.callSession.findMany({
      where,
      take: limit + 1,
      orderBy: { startedAt: 'desc' },
    });

    const hasMore = calls.length > limit;
    const data = hasMore ? calls.slice(0, limit) : calls;
    return {
      data,
      meta: { cursor: hasMore ? data[data.length - 1].id : null, hasMore },
    };
  }

  /** Cross-provider booking list with filters. */
  async listBookings(opts: {
    cursor?: string;
    limit?: number;
    providerId?: string;
    status?: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
    from?: string;
    to?: string;
  }) {
    const limit = Math.min(opts.limit ?? 25, 100);
    const where: Prisma.BookingWhereInput = { isDeleted: false };
    if (opts.cursor) where.id = { lt: opts.cursor };
    if (opts.providerId) where.providerId = opts.providerId;
    if (opts.status) where.status = opts.status;
    if (opts.from || opts.to) {
      where.slot = {};
      if (opts.from) (where.slot as any).startsAt = { gte: new Date(opts.from) };
      if (opts.to) {
        (where.slot as any).startsAt = {
          ...(where.slot as any).startsAt,
          lte: new Date(opts.to),
        };
      }
    }

    const bookings = await this.prisma.booking.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        slot: { select: { startsAt: true, endsAt: true } },
        provider: { select: { id: true, name: true, city: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    const hasMore = bookings.length > limit;
    const data = hasMore ? bookings.slice(0, limit) : bookings;
    return {
      data,
      meta: { cursor: hasMore ? data[data.length - 1].id : null, hasMore },
    };
  }

  /** Provider list for SUPER_ADMIN — includes billing rollup. */
  async listAllProviders(opts: { verticalId?: string; q?: string }) {
    const where: Prisma.ProviderWhereInput = { isDeleted: false };
    if (opts.verticalId) where.verticalId = opts.verticalId;
    if (opts.q) where.OR = [
      { name: { contains: opts.q, mode: 'insensitive' } },
      { city: { contains: opts.q, mode: 'insensitive' } },
      { email: { contains: opts.q, mode: 'insensitive' } },
    ];

    return this.prisma.provider.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vertical: { select: { id: true, name: true, slug: true } },
        billing: {
          select: {
            freeQuota: true,
            freeBookingsUsed: true,
            paidBookingsCount: true,
            totalChargedCents: true,
            chargePerBookingCents: true,
          },
        },
        _count: { select: { bookings: true, staff: true } },
      },
    });
  }

  /** Providers whose owner hasn't accepted the invite yet. */
  async listOnboardingPipeline() {
    const pendingLinks = await this.prisma.magicLink.findMany({
      where: {
        purpose: 'ONBOARDING',
        consumedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        staff: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isActive: true,
            provider: { select: { id: true, name: true, city: true } },
          },
        },
      },
    });

    return pendingLinks.map((link) => ({
      magicLinkId: link.id,
      email: link.email,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      staff: link.staff,
    }));
  }
}
