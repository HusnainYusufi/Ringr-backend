import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { BookingStatus, Role, SlotStatus } from '@prisma/client';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(
    tenantId: string,
    user: JwtPayload,
    opts: {
      cursor?: string;
      limit?: number;
      from?: string;
      to?: string;
      status?: BookingStatus;
      order?: 'asc' | 'desc'; // by slot.startsAt; defaults to desc (history) for past, asc for upcoming
    } = {},
  ) {
    const limit = Math.min(opts.limit ?? 20, 100);
    const where: any = { isDeleted: false };

    // Scope by role
    if (user.role === Role.CUSTOMER) {
      where.customerId = user.sub;
    } else if (user.role === Role.PROVIDER_OWNER || user.role === Role.PROVIDER_STAFF) {
      where.providerId = user.providerId;
    }
    // TENANT_ADMIN and SUPER_ADMIN see everything in the tenant

    if (opts.status) {
      where.status = opts.status;
    }

    // Date filter operates on slot.startsAt — the appointment time, not when
    // the booking row was created. That's what dashboards mean by "today".
    if (opts.from || opts.to) {
      where.slot = {};
      if (opts.from) where.slot.startsAt = { ...(where.slot.startsAt ?? {}), gte: new Date(opts.from) };
      if (opts.to)   where.slot.startsAt = { ...(where.slot.startsAt ?? {}), lte: new Date(opts.to) };
    }

    if (opts.cursor) {
      where.id = { lt: opts.cursor };
    }

    const order = opts.order ?? 'desc';
    const bookings = await this.prisma.booking.findMany({
      where,
      take: limit + 1,
      // When the caller filters by date, they almost always want to sort by
      // appointment time. Otherwise default to createdAt for stable cursor pagination.
      orderBy: (opts.from || opts.to)
        ? { slot: { startsAt: order } }
        : { createdAt: order },
      include: {
        slot: true,
        provider: { select: { id: true, name: true, address: true, city: true, phone: true } },
        customer: { select: { id: true, name: true, phone: true } },
        subject: { select: { id: true, name: true, type: true } },
      },
    });

    const hasMore = bookings.length > limit;
    const data = hasMore ? bookings.slice(0, limit) : bookings;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return {
      data,
      meta: {
        cursor: nextCursor,
        hasMore,
        timestamp: new Date().toISOString(),
      },
    };
  }

  async findOne(id: string, tenantId: string, user: JwtPayload) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, isDeleted: false },
      include: {
        slot: true,
        provider: true,
        customer: { select: { id: true, name: true, phone: true } },
        subject: true,
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    this.assertAccess(booking, user);
    return booking;
  }

  async cancel(id: string, tenantId: string, user: JwtPayload) {
    const booking = await this.findOne(id, tenantId, user);

    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('Booking is already cancelled');
    }
    if (booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed booking');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.slot.update({
        where: { id: booking.slotId },
        data: { status: SlotStatus.AVAILABLE },
      });
      return tx.booking.update({
        where: { id },
        data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
      });
    });

    this.eventEmitter.emit('booking.cancelled', { booking: updated, tenantId });
    return updated;
  }

  async complete(id: string, tenantId: string, user: JwtPayload) {
    const booking = await this.findOne(id, tenantId, user);

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed bookings can be marked as completed');
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.COMPLETED, completedAt: new Date() },
    });

    // Billing listens on this event and writes a ledger entry. The
    // BillingLedgerEntry.bookingId unique constraint makes re-emits idempotent.
    this.eventEmitter.emit('booking.completed', { booking: updated, tenantId });
    return updated;
  }

  async markNoShow(id: string, tenantId: string, user: JwtPayload) {
    const booking = await this.findOne(id, tenantId, user);

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed bookings can be marked as no-show');
    }
    // Guard against marking future appointments as no-show.
    if (booking.slot.startsAt > new Date()) {
      throw new BadRequestException('Cannot mark a future appointment as no-show');
    }

    return this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.NO_SHOW },
    });
  }

  private assertAccess(booking: any, user: JwtPayload) {
    if (user.role === Role.SUPER_ADMIN || user.role === Role.TENANT_ADMIN) return;
    if (user.role === Role.CUSTOMER && booking.customerId !== user.sub) {
      throw new ForbiddenException('Access denied');
    }
    if (
      (user.role === Role.PROVIDER_OWNER || user.role === Role.PROVIDER_STAFF) &&
      booking.providerId !== user.providerId
    ) {
      throw new ForbiddenException('Access denied');
    }
  }
}
