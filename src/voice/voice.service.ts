import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { GeoService } from '../geo/geo.service';
import { AuthService } from '../auth/auth.service';
import { Tenant, SlotStatus, BookingStatus } from '@prisma/client';
import type Redis from 'ioredis';

// Response shapes returned to Retell. Each has a conversational `result`
// string the AI reads aloud, plus structured fields the AI references in
// subsequent tool calls (customer_id, slot_id, subject_id, …). Without these
// structured fields the AI cannot reliably extract IDs from the response
// string and the call flow breaks.
export interface ToolResult {
  result: string;
}
export interface VerifyOtpResult extends ToolResult {
  customer_id?: string;
  is_new_customer?: boolean;
}
export interface GetSubjectsResult extends ToolResult {
  subjects: Array<{ subject_id: string; name: string; type: string }>;
}
export interface FindProvidersResult extends ToolResult {
  options: Array<{
    slot_id: string;
    provider_id: string;
    provider_name: string;
    address: string;
    city: string;
    distance_km: number;
    starts_at: string; // ISO 8601
  }>;
}
export interface HoldSlotResult extends ToolResult {
  slot_id: string;
  expires_at: string; // ISO 8601 — 10 min from hold
}
export interface ConfirmBookingResult extends ToolResult {
  booking_id: string;
  slot_id: string;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly authService: AuthService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('slot-management') private readonly slotQueue: Queue,
    @InjectQueue('notifications') private readonly notifQueue: Queue,
  ) {}

  // ─── Tool: send_otp ───────────────────────────────────────────────────────

  async sendOtp(phone: string, tenant: Tenant, redis: Redis): Promise<ToolResult> {
    await this.authService.sendOtp(phone, tenant, redis);
    return {
      result: `A verification code has been sent to ${phone}. Please ask the caller to read it back to you.`,
    };
  }

  // ─── Tool: verify_otp ─────────────────────────────────────────────────────

  async verifyOtp(
    phone: string,
    code: string,
    tenant: Tenant,
    redis: Redis,
  ): Promise<VerifyOtpResult> {
    try {
      const result = await this.authService.verifyOtp(phone, code, tenant, redis);
      const customer = await this.prisma.customer.findFirst({ where: { phone } });
      const name = customer?.name;

      const message = result.isNewCustomer
        ? `Verified. I couldn't find an existing account for this number, so I've created one. How can I help you today?`
        : `Verified. Welcome back${name ? `, ${name}` : ''}! I can see your account. How can I help you today?`;

      return {
        result: message,
        customer_id: customer?.id,
        is_new_customer: result.isNewCustomer,
      };
    } catch {
      return {
        result: `The code didn't match. Please ask the caller to double-check the SMS and try again.`,
      };
    }
  }

  // ─── Tool: get_subjects ───────────────────────────────────────────────────

  async getSubjects(customerId: string, tenant: Tenant): Promise<GetSubjectsResult> {
    const subjects = await this.prisma.subject.findMany({
      where: { customerId, isDeleted: false },
    });

    if (subjects.length === 0) {
      return {
        result: `No existing records found for this customer. You'll need to collect the details now.`,
        subjects: [],
      };
    }

    const list = subjects.map((s) => `${s.name} (${s.type})`).join(', ');

    return {
      result: `Found ${subjects.length} record(s): ${list}. Please ask which one this visit is for, or if it's for a new one.`,
      subjects: subjects.map((s) => ({
        subject_id: s.id,
        name: s.name,
        type: s.type,
      })),
    };
  }

  // ─── Tool: find_providers ─────────────────────────────────────────────────

  async findProviders(
    postalCode: string,
    tenant: Tenant,
    verticalSlug?: string,
    subjectType?: string,
    visitReason?: string,
    preferredDate?: string,
  ): Promise<FindProvidersResult> {
    const searchDate = preferredDate ? new Date(preferredDate) : new Date();

    const results = await this.geo.findProvidersNear(
      postalCode,
      tenant.id,
      searchDate,
      undefined,
      verticalSlug,
    );

    if (results.length === 0) {
      const verticalNote = verticalSlug ? ` ${verticalSlug}` : '';
      return {
        result: `I couldn't find any available${verticalNote} providers near ${postalCode} for that date. Would you like to try a different date or expand the search area?`,
        options: [],
      };
    }

    const top = results.slice(0, 3);
    const formatted = top
      .map(
        (r, i) =>
          `Option ${i + 1}: ${r.provider.name} at ${r.provider.address}, ${r.provider.city} — ${r.distanceKm.toFixed(1)} km away. Next slot: ${this.formatSlotTime(r.slot.startsAt)}.`,
      )
      .join(' ');

    return {
      result: `I found ${top.length} provider(s) near ${postalCode}. ${formatted} Which would you prefer?`,
      options: top.map((r) => ({
        slot_id: r.slot.id,
        provider_id: r.provider.id,
        provider_name: r.provider.name,
        address: r.provider.address,
        city: r.provider.city,
        distance_km: Number(r.distanceKm.toFixed(2)),
        starts_at: new Date(r.slot.startsAt).toISOString(),
      })),
    };
  }

  // ─── Tool: hold_slot ──────────────────────────────────────────────────────

  async holdSlot(
    slotId: string,
    customerId: string,
    tenant: Tenant,
  ): Promise<HoldSlotResult> {
    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId, status: SlotStatus.AVAILABLE },
      include: { provider: true },
    });

    if (!slot) {
      return {
        result: `Sorry, that slot is no longer available. Let me search for another option.`,
        slot_id: slotId,
        expires_at: new Date().toISOString(),
      };
    }

    const heldAt = new Date();
    const expiresAt = new Date(heldAt.getTime() + 10 * 60 * 1000);

    await this.prisma.slot.update({
      where: { id: slotId },
      data: { status: SlotStatus.HELD, heldBy: customerId, heldAt },
    });

    // Auto-release after 10 minutes if booking isn't confirmed
    await this.slotQueue.add(
      'release-held-slot',
      { slotId, tenantId: tenant.id },
      { delay: 10 * 60 * 1000, jobId: `release:${slotId}` },
    );

    return {
      result: `I've held that slot for you at ${slot.provider.name} on ${this.formatSlotTime(slot.startsAt)}. You have 10 minutes to confirm. Shall I go ahead and confirm the booking?`,
      slot_id: slot.id,
      expires_at: expiresAt.toISOString(),
    };
  }

  // ─── Tool: confirm_booking ────────────────────────────────────────────────

  async confirmBooking(
    slotId: string,
    customerId: string,
    tenant: Tenant,
    subjectId?: string,
    extraFields?: Record<string, any>,
    notes?: string,
  ): Promise<ConfirmBookingResult> {
    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId },
      include: { provider: true },
    });

    if (!slot || (slot.status !== SlotStatus.HELD && slot.status !== SlotStatus.AVAILABLE)) {
      return {
        result: `I wasn't able to confirm the booking — the slot is no longer available. Let me find another option.`,
        booking_id: '',
        slot_id: slotId,
      };
    }

    // Atomic: mark slot as BOOKED and create booking record
    const booking = await this.prisma.$transaction(async (tx) => {
      await tx.slot.update({
        where: { id: slotId },
        data: { status: SlotStatus.BOOKED, heldBy: null, heldAt: null },
      });

      return tx.booking.create({
        data: {
          tenantId: tenant.id,
          slotId,
          customerId,
          providerId: slot.providerId,
          subjectId: subjectId ?? null,
          status: BookingStatus.CONFIRMED,
          extraFields: extraFields ?? {},
          notes: notes ?? null,
        },
        include: { provider: true, slot: true },
      });
    });

    // Cancel the auto-release job since we've confirmed
    const releaseJob = await this.slotQueue.getJob(`release:${slotId}`);
    if (releaseJob) await releaseJob.remove();

    // Trigger async notifications via event
    this.eventEmitter.emit('booking.confirmed', { booking, tenantId: tenant.id });

    const dateStr = this.formatSlotTime(slot.startsAt);
    return {
      result: `Your appointment at ${slot.provider.name} is confirmed for ${dateStr}. You'll receive a confirmation SMS shortly. Is there anything else I can help you with?`,
      booking_id: booking.id,
      slot_id: slot.id,
    };
  }

  // ─── Webhook: call lifecycle ───────────────────────────────────────────────

  async handleCallStarted(callId: string, agentId: string, fromPhone: string, tenantId: string) {
    await this.prisma.callSession.create({
      data: { callId, agentId, fromPhone, tenantId },
    });
    this.logger.log(`Call started: ${callId} from ${fromPhone}`);
  }

  async handleCallEnded(
    callId: string,
    transcript?: string,
    summary?: string,
    durationMs?: number,
  ) {
    await this.prisma.callSession.updateMany({
      where: { callId },
      data: {
        transcript: transcript ?? null,
        summary: summary ?? null,
        durationMs: durationMs ?? null,
        endedAt: new Date(),
      },
    });
    this.logger.log(`Call ended: ${callId} (${durationMs}ms)`);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private formatSlotTime(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Toronto',
    }).format(new Date(date));
  }
}
