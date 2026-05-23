import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { GeoService } from '../geo/geo.service';
import {
  Tenant,
  Customer,
  Prisma,
  SlotStatus,
  BookingStatus,
} from '@prisma/client';

// Response shapes returned to Retell. Each has a conversational `result`
// string the AI reads aloud, plus structured sibling fields the AI extracts
// for use in subsequent tool calls. Without these structured fields the AI
// would have to parse IDs out of natural-language strings — fragile.
export interface ToolResult {
  result: string;
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
  slot_id: string | null;
  expires_at?: string; // ISO 8601 — 10 min from hold; absent on failure
}
export interface ConfirmBookingResult extends ToolResult {
  booking_id: string | null;
  slot_id: string;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('slot-management') private readonly slotQueue: Queue,
  ) {}

  // ─── Customer resolution (no OTP) ─────────────────────────────────────────

  /**
   * Identify (or create) the customer behind a phone number. Called at the
   * start of every tool that needs a customer context. Idempotent — second
   * call with the same phone returns the existing row.
   *
   * The Prisma tenant middleware auto-injects tenantId into both the findFirst
   * filter and the create data, so passing tenantId here is belt-and-braces
   * (and survives any future change to the middleware).
   */
  async resolveCustomer(phone: string, tenantId: string): Promise<Customer> {
    const existing = await this.prisma.customer.findFirst({
      where: { phone, isDeleted: false },
    });
    if (existing) return existing;

    try {
      return await this.prisma.customer.create({
        data: { phone, tenantId },
      });
    } catch (err) {
      // Race: another concurrent tool call created the customer between our
      // findFirst and create. The unique (tenantId, phone) constraint catches
      // it — refetch and return the winner.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const customer = await this.prisma.customer.findFirst({
          where: { phone, isDeleted: false },
        });
        if (customer) return customer;
      }
      throw err;
    }
  }

  // ─── Tool: get_subjects ───────────────────────────────────────────────────

  async getSubjects(phone: string, tenant: Tenant): Promise<GetSubjectsResult> {
    const customer = await this.resolveCustomer(phone, tenant.id);

    const subjects = await this.prisma.subject.findMany({
      where: { customerId: customer.id, isDeleted: false },
    });

    if (subjects.length === 0) {
      return {
        result: `I don't have any records on file for you yet. Could you tell me your pet's name and what kind of animal they are?`,
        subjects: [],
      };
    }

    const list = subjects.map((s) => `${s.name} (${s.type})`).join(', ');
    return {
      result: `Found ${subjects.length} record(s): ${list}. Which one is this visit for?`,
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
    _subjectType?: string,
    _visitReason?: string,
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
        result: `I couldn't find any available${verticalNote} providers near ${postalCode} for that date. Could you try a nearby postal code or a different date?`,
        options: [],
      };
    }

    const top = results.slice(0, 3);
    const formatted = top
      .map(
        (r, i) =>
          `Option ${i + 1}: ${r.provider.name} at ${r.provider.address}, ${r.provider.city} — ${r.distanceKm.toFixed(1)} km away. Available ${this.formatSlotTime(r.slot.startsAt)}.`,
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
    fromPhone: string,
    tenant: Tenant,
  ): Promise<HoldSlotResult> {
    const customer = await this.resolveCustomer(fromPhone, tenant.id);

    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId, status: SlotStatus.AVAILABLE },
      include: { provider: true },
    });

    if (!slot) {
      return {
        result: `Sorry, that slot was just taken by someone else. Let me find you another option.`,
        slot_id: null,
      };
    }

    const heldAt = new Date();
    const expiresAt = new Date(heldAt.getTime() + 10 * 60 * 1000);

    await this.prisma.slot.update({
      where: { id: slotId },
      data: { status: SlotStatus.HELD, heldBy: customer.id, heldAt },
    });

    // Auto-release after 10 minutes if booking isn't confirmed. Job ID is
    // deterministic so confirm_booking can cancel it cleanly.
    await this.slotQueue.add(
      'release-held-slot',
      { slotId, tenantId: tenant.id },
      { delay: 10 * 60 * 1000, jobId: `release:${slotId}` },
    );

    return {
      result: `I have held that slot at ${slot.provider.name} for ${this.formatSlotTime(slot.startsAt)}. You have 10 minutes to confirm. Shall I go ahead and book it?`,
      slot_id: slot.id,
      expires_at: expiresAt.toISOString(),
    };
  }

  // ─── Tool: confirm_booking ────────────────────────────────────────────────

  async confirmBooking(
    slotId: string,
    fromPhone: string,
    tenant: Tenant,
    subjectId?: string,
    extraFields?: Record<string, any>,
    notes?: string,
  ): Promise<ConfirmBookingResult> {
    const customer = await this.resolveCustomer(fromPhone, tenant.id);

    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId },
      include: { provider: true },
    });

    // Strict: we only confirm slots that were properly held. A still-AVAILABLE
    // slot means hold_slot wasn't called — race condition or buggy agent.
    if (!slot || slot.status !== SlotStatus.HELD) {
      return {
        result: `It looks like the hold on that slot just expired. Let me find you another available time.`,
        booking_id: null,
        slot_id: slotId,
      };
    }

    // Atomic: HELD → BOOKED + create Booking. If anything inside throws,
    // the slot stays HELD and the Bull auto-release job will clean up.
    const booking = await this.prisma.$transaction(async (tx) => {
      await tx.slot.update({
        where: { id: slotId },
        data: { status: SlotStatus.BOOKED, heldBy: null, heldAt: null },
      });

      return tx.booking.create({
        data: {
          tenantId: tenant.id,
          slotId,
          customerId: customer.id,
          providerId: slot.providerId,
          subjectId: subjectId ?? null,
          status: BookingStatus.CONFIRMED,
          extraFields: extraFields ?? {},
          notes: notes ?? null,
        },
        include: { provider: true, slot: true },
      });
    });

    // Cancel the auto-release job — fire-and-forget. If the job already fired
    // (unlikely given the 10-min window vs sub-second confirm), the slot is
    // already BOOKED so the release no-ops.
    const releaseJob = await this.slotQueue.getJob(`release:${slotId}`);
    if (releaseJob) await releaseJob.remove();

    // Triggers SMS via the NotificationModule's @OnEvent('booking.confirmed').
    this.eventEmitter.emit('booking.confirmed', { booking, tenantId: tenant.id });

    const dateStr = this.formatSlotTime(slot.startsAt);
    return {
      result: `Your appointment at ${slot.provider.name} is confirmed for ${dateStr}. You will receive a confirmation SMS shortly. Is there anything else I can help you with?`,
      booking_id: booking.id,
      slot_id: slot.id,
    };
  }

  // ─── Webhook: call lifecycle ──────────────────────────────────────────────

  async handleCallStarted(
    callId: string,
    agentId: string,
    fromPhone: string,
    tenantId: string,
  ) {
    // Upsert customer eagerly so the call record + the customer record are
    // both available before the AI starts firing tool calls.
    await this.resolveCustomer(fromPhone, tenantId);

    try {
      await this.prisma.callSession.create({
        data: { callId, agentId, fromPhone, tenantId },
      });
    } catch (err) {
      // Unique constraint on callId — retried webhook is a no-op.
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      ) {
        throw err;
      }
      this.logger.debug(`call_started retry for ${callId} — already recorded`);
    }
    this.logger.log(`Call started: ${callId} from ${fromPhone}`);
  }

  async handleCallEnded(
    callId: string,
    transcript?: string,
    durationMs?: number,
  ) {
    const result = await this.prisma.callSession.updateMany({
      where: { callId },
      data: {
        transcript: transcript ?? null,
        durationMs: durationMs ?? null,
        endedAt: new Date(),
      },
    });
    if (result.count === 0) {
      this.logger.warn(`call_ended for unknown callId ${callId}`);
    } else {
      this.logger.log(`Call ended: ${callId} (${durationMs ?? 0}ms)`);
    }
  }

  async handleCallAnalyzed(callId: string, summary?: string) {
    const result = await this.prisma.callSession.updateMany({
      where: { callId },
      data: { summary: summary ?? null },
    });
    if (result.count === 0) {
      this.logger.warn(`call_analyzed for unknown callId ${callId}`);
    } else {
      this.logger.log(`Call analyzed: ${callId}`);
    }
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
