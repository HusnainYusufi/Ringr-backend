import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionTier, SubscriptionStatus } from '@prisma/client';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent — called from the onboarding flow. */
  async ensureSubscription(
    providerId: string,
    tenantId: string,
    tier: SubscriptionTier = SubscriptionTier.STARTER,
  ) {
    const existing = await this.prisma.subscription.findUnique({
      where: { providerId },
    });
    if (existing) return existing;
    return this.prisma.subscription.create({
      data: { tenantId, providerId, tier, status: SubscriptionStatus.ACTIVE },
    });
  }

  async getForProvider(providerId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { providerId },
    });
    if (!sub) throw new NotFoundException('No subscription for this provider');
    return sub;
  }

  /** Returns null instead of throwing — used by /auth/me to avoid blowing up if billing isn't set up. */
  async findForProvider(providerId: string) {
    return this.prisma.subscription.findUnique({ where: { providerId } });
  }

  async changeTier(providerId: string, tier: SubscriptionTier) {
    const sub = await this.prisma.subscription.findUnique({
      where: { providerId },
    });
    if (!sub) throw new NotFoundException('No subscription for this provider');
    if (sub.status === SubscriptionStatus.CANCELLED) {
      throw new ConflictException('Cannot change tier on a cancelled subscription');
    }
    return this.prisma.subscription.update({
      where: { providerId },
      data: { tier },
    });
  }

  async cancel(providerId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { providerId },
    });
    if (!sub) throw new NotFoundException('No subscription for this provider');
    return this.prisma.subscription.update({
      where: { providerId },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });
  }

  async reactivate(providerId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { providerId },
    });
    if (!sub) throw new NotFoundException('No subscription for this provider');
    return this.prisma.subscription.update({
      where: { providerId },
      data: { status: SubscriptionStatus.ACTIVE, cancelledAt: null },
    });
  }

  /** SUPER_ADMIN cross-provider view. */
  async listAll(opts: { tier?: SubscriptionTier; status?: SubscriptionStatus } = {}) {
    return this.prisma.subscription.findMany({
      where: {
        ...(opts.tier && { tier: opts.tier }),
        ...(opts.status && { status: opts.status }),
      },
      include: {
        provider: { select: { id: true, name: true, city: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
