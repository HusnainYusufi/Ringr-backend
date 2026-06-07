import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { GeoService } from '../geo/geo.service';
import {
  Customer,
  Prisma,
  SlotStatus,
  BookingStatus,
} from '@prisma/client';

// ─── Tool result shapes ───────────────────────────────────────────────────────
// Each has a conversational `result` string the AI reads aloud, plus structured
// sibling fields the AI extracts and passes to subsequent tool calls.

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
    starts_at: string;
  }>;
}
export interface HoldSlotResult extends ToolResult {
  slot_id: string | null;
  expires_at?: string;
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

  // ─── Customer resolution ──────────────────────────────────────────────────
  // Explicit tenantId in where clause because the voice controller runs with
  // bypassTenant=true — the Prisma middleware will NOT auto-inject it.

  async resolveCustomer(phone: string, tenantId: string): Promise<Customer> {
    const existing = await this.prisma.customer.findFirst({
      where: { phone, tenantId, isDeleted: false },
    });
    if (existing) return existing;

    try {
      return await this.prisma.customer.create({
        data: { phone, tenantId },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const customer = await this.prisma.customer.findFirst({
          where: { phone, tenantId, isDeleted: false },
        });
        if (customer) return customer;
      }
      throw err;
    }
  }

  // ─── Tool: get_subjects ───────────────────────────────────────────────────
  // provider_id tells us which tenant to search — required for global-agent mode.

  async getSubjects(phone: string, providerId?: string): Promise<GetSubjectsResult> {
    if (!providerId) {
      return {
        result: `I need to know which clinic you're calling about before I can look up your records. Let me find the nearest one for you first.`,
        subjects: [],
      };
    }

    const provider = await this.prisma.provider.findFirst({
      where: { id: providerId },
    });
    if (!provider) {
      return { result: `I couldn't find that clinic. Let me search again.`, subjects: [] };
    }

    const customer = await this.resolveCustomer(phone, provider.tenantId);

    const subjects = await this.prisma.subject.findMany({
      where: { customerId: customer.id, tenantId: provider.tenantId, isDeleted: false },
    });

    if (subjects.length === 0) {
      return {
        result: `I don't have any records on file for you at that clinic yet. Could you tell me the name and type of your pet or the reason for your visit?`,
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
  // Global search — no tenant filter. AI passes vertical_slug ("vet", "dental",
  // "auto") and a postal code; we return the 3 nearest clinics with open slots.

  async findProviders(
    postalCode: string,
    verticalSlug?: string,
    preferredDate?: string,
  ): Promise<FindProvidersResult> {
    const searchDate = preferredDate ? new Date(preferredDate) : new Date();

    const results = await this.geo.findProvidersGlobalNear(
      postalCode,
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
  // provider_id is required — we derive the tenant from it.

  async holdSlot(
    slotId: string,
    providerId: string,
    fromPhone: string,
  ): Promise<HoldSlotResult> {
    const provider = await this.prisma.provider.findFirst({
      where: { id: providerId },
    });
    if (!provider) {
      return { result: `I couldn't find that clinic. Please try again.`, slot_id: null };
    }

    const customer = await this.resolveCustomer(fromPhone, provider.tenantId);

    // Explicit providerId in where so we don't accidentally hold another clinic's slot.
    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId, providerId, tenantId: provider.tenantId, status: SlotStatus.AVAILABLE },
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

    await this.slotQueue.add(
      'release-held-slot',
      { slotId, tenantId: provider.tenantId },
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
    providerId: string,
    fromPhone: string,
    subjectId?: string,
    extraFields?: Record<string, any>,
    notes?: string,
  ): Promise<ConfirmBookingResult> {
    const provider = await this.prisma.provider.findFirst({
      where: { id: providerId },
    });
    if (!provider) {
      return { result: `I couldn't find that clinic. Please try again.`, booking_id: null, slot_id: slotId };
    }

    const customer = await this.resolveCustomer(fromPhone, provider.tenantId);

    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId, providerId, tenantId: provider.tenantId },
      include: { provider: true },
    });

    if (!slot || slot.status !== SlotStatus.HELD) {
      return {
        result: `It looks like the hold on that slot just expired. Let me find you another available time.`,
        booking_id: null,
        slot_id: slotId,
      };
    }

    const booking = await this.prisma.$transaction(async (tx) => {
      await tx.slot.update({
        where: { id: slotId },
        data: { status: SlotStatus.BOOKED, heldBy: null, heldAt: null },
      });

      return tx.booking.create({
        data: {
          tenantId: provider.tenantId,
          slotId,
          customerId: customer.id,
          providerId,
          subjectId: subjectId ?? null,
          status: BookingStatus.CONFIRMED,
          extraFields: extraFields ?? {},
          notes: notes ?? null,
        },
        include: { provider: true, slot: true },
      });
    });

    const releaseJob = await this.slotQueue.getJob(`release:${slotId}`);
    if (releaseJob) await releaseJob.remove();

    // Update call session with tenantId and bookingId now that we know the tenant.
    this.eventEmitter.emit('booking.confirmed', { booking, tenantId: provider.tenantId });

    const dateStr = this.formatSlotTime(slot.startsAt);
    return {
      result: `Your appointment at ${slot.provider.name} is confirmed for ${dateStr}. You will receive a confirmation SMS shortly. Is there anything else I can help you with?`,
      booking_id: booking.id,
      slot_id: slot.id,
    };
  }

  // ─── Webhook: call lifecycle ──────────────────────────────────────────────
  // tenantId removed — global agent has no tenant context at call_started time.

  async handleCallStarted(callId: string, agentId: string, fromPhone: string) {
    try {
      await this.prisma.callSession.create({
        data: { callId, agentId, fromPhone },
      });
    } catch (err) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      ) {
        throw err;
      }
      this.logger.debug(`call_started retry for ${callId} — already recorded`);
    }
    this.logger.log(`Call started: ${callId} from ${fromPhone}`);
  }

  async handleCallEnded(callId: string, transcript?: string, durationMs?: number) {
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
