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

  async findAll(tenantId: string, user: JwtPayload, cursor?: string, limit = 20) {
    const where: any = { isDeleted: false };

    // Scope by role
    if (user.role === Role.CUSTOMER) {
      where.customerId = user.sub;
    } else if (user.role === Role.PROVIDER_OWNER || user.role === Role.PROVIDER_STAFF) {
      where.providerId = user.providerId;
    }
    // TENANT_ADMIN and SUPER_ADMIN see everything in the tenant

    if (cursor) {
      where.id = { lt: cursor };
    }

    const bookings = await this.prisma.booking.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
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

    return this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.COMPLETED, completedAt: new Date() },
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
