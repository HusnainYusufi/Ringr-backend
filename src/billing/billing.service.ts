import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { Booking, Prisma } from '@prisma/client';

export interface AdjustBillingDto {
  freeQuota?: number;
  chargePerBookingCents?: number;
  creditCents?: number; // POSITIVE = credit (reduces totalChargedCents); recorded in ledger.
  reason?: string;
}

/**
 * Billing service — v1 model: flat fee per completed booking after a free quota.
 *
 * Lifecycle:
 *   onboardProvider() → ensureBilling(providerId)
 *   booking.completed event → recordBookingCompleted(booking)
 *     → first `freeQuota` completed bookings: ledger entry type=FREE, amount=0
 *     → subsequent: ledger entry type=CHARGE, amount=chargePerBookingCents
 *
 * The unique constraint on BillingLedgerEntry.bookingId means duplicate
 * `booking.completed` events are a no-op (idempotent at the DB level).
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent — called from the SUPER_ADMIN onboarding flow. */
  async ensureBilling(providerId: string, tenantId: string) {
    const existing = await this.prisma.providerBilling.findUnique({
      where: { providerId },
    });
    if (existing) return existing;
    return this.prisma.providerBilling.create({
      data: { tenantId, providerId },
    });
  }

  /** Provider sees their own billing summary. */
  async getProviderBilling(providerId: string) {
    const billing = await this.prisma.providerBilling.findUnique({
      where: { providerId },
    });
    if (!billing) {
      throw new NotFoundException('Billing record not found for this provider');
    }
    return {
      ...billing,
      freeBookingsRemaining: Math.max(0, billing.freeQuota - billing.freeBookingsUsed),
    };
  }

  /** Provider's ledger (paginated by createdAt desc). */
  async listLedgerEntries(
    providerId: string,
    opts: { cursor?: string; limit?: number } = {},
  ) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const entries = await this.prisma.billingLedgerEntry.findMany({
      where: { providerId, ...(opts.cursor && { id: { lt: opts.cursor } }) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = entries.length > limit;
    const data = hasMore ? entries.slice(0, limit) : entries;
    return {
      data,
      meta: {
        cursor: hasMore ? data[data.length - 1].id : null,
        hasMore,
      },
    };
  }

  /** SUPER_ADMIN unified billing view — all providers, one row each. */
  async listAllBilling() {
    return this.prisma.providerBilling.findMany({
      include: {
        provider: { select: { id: true, name: true, city: true, verticalId: true } },
      },
      orderBy: { totalChargedCents: 'desc' },
    });
  }

  /** SUPER_ADMIN adjusts billing settings for a provider. */
  async adjustBilling(providerId: string, dto: AdjustBillingDto) {
    const billing = await this.prisma.providerBilling.findUnique({
      where: { providerId },
    });
    if (!billing) throw new NotFoundException('Billing record not found');

    const update: Prisma.ProviderBillingUpdateInput = {};
    if (dto.freeQuota != null) {
      if (dto.freeQuota < 0) throw new BadRequestException('freeQuota must be >= 0');
      update.freeQuota = dto.freeQuota;
    }
    if (dto.chargePerBookingCents != null) {
      if (dto.chargePerBookingCents < 0) {
        throw new BadRequestException('chargePerBookingCents must be >= 0');
      }
      update.chargePerBookingCents = dto.chargePerBookingCents;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.providerBilling.update({
        where: { providerId },
        data: update,
      });

      // A credit reduces the totalChargedCents and is recorded in the ledger.
      // Booking-less ledger entries use a synthetic id so the bookingId unique
      // constraint still holds.
      if (dto.creditCents && dto.creditCents > 0) {
        await tx.providerBilling.update({
          where: { providerId },
          data: { totalChargedCents: { decrement: dto.creditCents } },
        });
        await tx.billingLedgerEntry.create({
          data: {
            tenantId: billing.tenantId,
            providerId,
            billingId: billing.id,
            bookingId: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            type: 'CREDIT',
            amountCents: -dto.creditCents,
            description: dto.reason ?? 'Manual credit',
          },
        });
        return tx.providerBilling.findUnique({ where: { providerId } });
      }

      return updated;
    });
  }

  // ─── Event hook ────────────────────────────────────────────────────────────

  /**
   * Fired by BookingsService.complete(). We never bill on `booking.confirmed`
   * (caller-cancelled / no-show would result in unfair charges).
   */
  @OnEvent('booking.completed')
  async recordBookingCompleted(payload: { booking: Booking; tenantId: string }) {
    const { booking, tenantId } = payload;

    const billing = await this.prisma.providerBilling.findUnique({
      where: { providerId: booking.providerId },
    });
    if (!billing) {
      // Onboarded before billing existed, or seed didn't create a billing row.
      // Auto-heal so we don't drop the charge.
      this.logger.warn(
        `No billing record for provider ${booking.providerId}; auto-creating.`,
      );
      await this.ensureBilling(booking.providerId, tenantId);
      return this.recordBookingCompleted(payload); // retry once
    }

    const isFree = billing.freeBookingsUsed < billing.freeQuota;
    const amount = isFree ? 0 : billing.chargePerBookingCents;

    try {
      await this.prisma.$transaction([
        this.prisma.billingLedgerEntry.create({
          data: {
            tenantId,
            providerId: booking.providerId,
            billingId: billing.id,
            bookingId: booking.id,
            type: isFree ? 'FREE' : 'CHARGE',
            amountCents: amount,
            description: isFree
              ? `Free booking ${billing.freeBookingsUsed + 1} of ${billing.freeQuota}`
              : `Booking charge`,
          },
        }),
        this.prisma.providerBilling.update({
          where: { id: billing.id },
          data: isFree
            ? { freeBookingsUsed: { increment: 1 } }
            : {
                paidBookingsCount: { increment: 1 },
                totalChargedCents: { increment: amount },
                lastChargedAt: new Date(),
              },
        }),
      ]);
    } catch (err) {
      // The unique constraint on bookingId means the second call is a no-op
      // — exactly the idempotency we want if the event fires twice.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.debug(`Booking ${booking.id} already billed — skipping.`);
        return;
      }
      throw err;
    }
  }
}
