import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Job } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { NotificationsService } from '../notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

interface BookingNotificationJob {
  bookingId: string;
  tenantId: string;
  type: 'confirmation' | 'cancellation';
}

@Processor('notifications')
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    @InjectQueue('reminders') private readonly remindersQueue: Queue,
  ) {}

  @Process('send-booking-confirmation')
  async handleBookingConfirmation(job: Job<BookingNotificationJob>) {
    const { bookingId } = job.data;

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId },
      include: {
        customer: true,
        provider: true,
        slot: true,
        tenant: { include: { vertical: true } },
      },
    });

    if (!booking) {
      this.logger.warn(`Booking ${bookingId} not found for notification`);
      return;
    }

    const appointmentLabel =
      (booking.tenant.vertical.config as any)?.appointmentLabel ?? 'appointment';
    const dateStr = this.formatDate(booking.slot.startsAt);

    await this.notificationsService.sendSms({
      to: booking.customer.phone,
      body: this.notificationsService.buildBookingConfirmationSms(
        booking.provider.name,
        dateStr,
        booking.provider.address,
        appointmentLabel,
      ),
    });

    // Schedule 24hr and 2hr reminders
    const now = Date.now();
    const apptTime = new Date(booking.slot.startsAt).getTime();
    const delay24h = apptTime - 24 * 60 * 60 * 1000 - now;
    const delay2h = apptTime - 2 * 60 * 60 * 1000 - now;

    if (delay24h > 0) {
      await this.remindersQueue.add(
        'send-reminder',
        { bookingId, hoursAhead: 24 },
        { delay: delay24h, jobId: `reminder:24h:${bookingId}`, attempts: 3, backoff: 60000 },
      );
    }

    if (delay2h > 0) {
      await this.remindersQueue.add(
        'send-reminder',
        { bookingId, hoursAhead: 2 },
        { delay: delay2h, jobId: `reminder:2h:${bookingId}`, attempts: 3, backoff: 60000 },
      );
    }
  }

  @Process('send-booking-cancellation')
  async handleBookingCancellation(job: Job<BookingNotificationJob>) {
    const { bookingId } = job.data;

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId },
      include: {
        customer: true,
        provider: true,
        tenant: { include: { vertical: true } },
      },
    });

    if (!booking) return;

    const appointmentLabel =
      (booking.tenant.vertical.config as any)?.appointmentLabel ?? 'appointment';

    await this.notificationsService.sendSms({
      to: booking.customer.phone,
      body: this.notificationsService.buildCancellationSms(
        booking.provider.name,
        appointmentLabel,
      ),
    });
  }

  // ─── Event listeners ──────────────────────────────────────────────────────

  @OnEvent('booking.confirmed')
  async onBookingConfirmed(payload: { booking: any; tenantId: string }) {
    // Queue the notification so the voice tool response returns immediately.
    // Must enqueue to the 'notifications' queue — that's where this processor's
    // @Process handlers live. Earlier code enqueued to 'reminders' and the jobs
    // were silently dropped (no matching processor on that queue).
    await this.notificationsQueue.add(
      'send-booking-confirmation',
      { bookingId: payload.booking.id, tenantId: payload.tenantId, type: 'confirmation' },
      { attempts: 3, backoff: 30000 },
    );
  }

  @OnEvent('booking.cancelled')
  async onBookingCancelled(payload: { booking: any; tenantId: string }) {
    await this.notificationsQueue.add(
      'send-booking-cancellation',
      { bookingId: payload.booking.id, tenantId: payload.tenantId, type: 'cancellation' },
      { attempts: 3, backoff: 30000 },
    );
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(date));
  }
}
