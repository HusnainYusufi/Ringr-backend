import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { NotificationsService } from '../notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingStatus } from '@prisma/client';

interface ReminderJob {
  bookingId: string;
  tenantId: string;
  hoursAhead: number;
}

interface SlotReleaseJob {
  slotId: string;
  tenantId: string;
}

@Processor('reminders')
export class ReminderProcessor {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Process('send-reminder')
  async handleReminder(job: Job<ReminderJob>) {
    const { bookingId, hoursAhead } = job.data;

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId },
      include: {
        customer: true,
        provider: true,
        slot: true,
        tenant: { include: { vertical: true } },
      },
    });

    if (!booking || booking.status !== BookingStatus.CONFIRMED) {
      this.logger.log(`Skipping reminder for booking ${bookingId} — not confirmed`);
      return;
    }

    const appointmentLabel =
      (booking.tenant.vertical.config as any)?.appointmentLabel ?? 'appointment';
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(booking.slot.startsAt));

    await this.notificationsService.sendSms({
      to: booking.customer.phone,
      body: this.notificationsService.buildReminderSms(
        booking.provider.name,
        dateStr,
        hoursAhead,
        appointmentLabel,
      ),
    });

    this.logger.log(`${hoursAhead}hr reminder sent for booking ${bookingId}`);
  }
}

@Processor('slot-management')
export class SlotManagementProcessor {
  private readonly logger = new Logger(SlotManagementProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process('release-held-slot')
  async handleReleaseHeldSlot(job: Job<SlotReleaseJob>) {
    const { slotId } = job.data;

    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId, status: 'HELD' },
    });

    if (!slot) {
      this.logger.log(`Slot ${slotId} is no longer HELD — nothing to release`);
      return;
    }

    await this.prisma.slot.update({
      where: { id: slotId },
      data: { status: 'AVAILABLE', heldBy: null, heldAt: null },
    });

    this.logger.log(`Slot ${slotId} released back to AVAILABLE after 10-minute hold expiry`);
  }
}
