import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { VoiceService } from './voice.service';
import { RetellWebhookGuard } from '../common/guards/retell-webhook.guard';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import {
  ConfirmBookingToolDto,
  FindProvidersToolDto,
  GetSubjectsToolDto,
  HoldSlotToolDto,
} from './dto/voice-tool.dto';
import { RetellWebhookDto } from './dto/webhook.dto';
import { Tenant } from '@prisma/client';

/**
 * Retell-facing voice endpoints. Auth is HMAC (not JWT) — callers are
 * external (Retell's cloud), not portal users. Tenant resolves from the
 * agent_id Retell sends in every request body via TenantInterceptor.
 *
 * No OTP: the caller is identified by call.from_number. Every tool resolves
 * (or creates) the Customer for that phone via VoiceService.resolveCustomer.
 *
 * All endpoints return their bodies verbatim (@SkipTransform) — Retell tool
 * configs read fields directly off the top level, not through { data, meta }.
 */
@Controller('voice')
@Public()
@SkipThrottle()
@SkipTransform()
@UseGuards(RetellWebhookGuard)
@UseInterceptors(TenantInterceptor)
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(private readonly voiceService: VoiceService) {}

  // ─── Call lifecycle webhook ──────────────────────────────────────────────

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: RetellWebhookDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    const { event, call } = body;

    try {
      if (event === 'call_started') {
        await this.voiceService.handleCallStarted(
          call.call_id,
          call.agent_id,
          call.from_number ?? 'unknown',
          tenant.id,
        );
      } else if (event === 'call_ended') {
        await this.voiceService.handleCallEnded(
          call.call_id,
          call.transcript,
          call.duration_ms,
        );
      } else if (event === 'call_analyzed') {
        await this.voiceService.handleCallAnalyzed(
          call.call_id,
          call.call_analysis?.call_summary,
        );
      } else {
        this.logger.warn(`Unhandled Retell webhook event: ${event}`);
      }
    } catch (err) {
      // Webhook failures shouldn't 500 — Retell may retry indefinitely and a
      // dead-letter loop helps nobody. Log and acknowledge.
      this.logger.error(
        `Webhook error for event ${event} / call ${call.call_id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    return { received: true };
  }

  // ─── Tools ───────────────────────────────────────────────────────────────
  //
  // Every tool wraps its service call in try/catch and returns a friendly
  // result string on failure. Throwing a 500 here would break the live
  // phone call (the caller hears silence while Retell waits for a response).

  @Post('tools/get-subjects')
  @HttpCode(HttpStatus.OK)
  async getSubjects(
    @Body() body: GetSubjectsToolDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    try {
      const phone = body.phone ?? body.call?.from_number;
      if (!phone) {
        return {
          result: `I'm having trouble identifying you. Could you try calling again?`,
          subjects: [],
        };
      }
      return await this.voiceService.getSubjects(phone, tenant);
    } catch (err) {
      this.logger.error(`get_subjects failed: ${err instanceof Error ? err.message : err}`);
      return {
        result: `I'm having trouble looking up your records right now. Let me try again in a moment.`,
        subjects: [],
      };
    }
  }

  @Post('tools/find-providers')
  @HttpCode(HttpStatus.OK)
  async findProviders(
    @Body() body: FindProvidersToolDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    try {
      return await this.voiceService.findProviders(
        body.postal_code,
        tenant,
        body.vertical_slug,
        body.subject_type,
        body.visit_reason,
        body.preferred_date,
      );
    } catch (err) {
      this.logger.error(`find_providers failed: ${err instanceof Error ? err.message : err}`);
      return {
        result: `I'm having trouble searching for providers right now. Could you give me a moment?`,
        options: [],
      };
    }
  }

  @Post('tools/hold-slot')
  @HttpCode(HttpStatus.OK)
  async holdSlot(
    @Body() body: HoldSlotToolDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    try {
      const phone = body.call?.from_number;
      if (!phone) {
        return {
          result: `I'm having trouble identifying you. Could you try calling again?`,
          slot_id: null,
        };
      }
      return await this.voiceService.holdSlot(body.slot_id, phone, tenant);
    } catch (err) {
      this.logger.error(`hold_slot failed: ${err instanceof Error ? err.message : err}`);
      return {
        result: `I couldn't hold that slot right now. Let me find you another option.`,
        slot_id: null,
      };
    }
  }

  @Post('tools/confirm-booking')
  @HttpCode(HttpStatus.OK)
  async confirmBooking(
    @Body() body: ConfirmBookingToolDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    try {
      const phone = body.call?.from_number;
      if (!phone) {
        return {
          result: `I'm having trouble identifying you. Could you try calling again?`,
          booking_id: null,
          slot_id: body.slot_id,
        };
      }
      return await this.voiceService.confirmBooking(
        body.slot_id,
        phone,
        tenant,
        body.subject_id,
        body.extra_fields,
        body.notes,
      );
    } catch (err) {
      this.logger.error(`confirm_booking failed: ${err instanceof Error ? err.message : err}`);
      return {
        result: `I couldn't confirm that booking. Let me try again.`,
        booking_id: null,
        slot_id: body.slot_id,
      };
    }
  }
}
