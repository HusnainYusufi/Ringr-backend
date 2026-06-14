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
import { SkipTenant } from '../tenant/skip-tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import {
  ConfirmBookingToolDto,
  FindProvidersToolDto,
  GetSubjectsToolDto,
  HoldSlotToolDto,
} from './dto/voice-tool.dto';
import { RetellWebhookDto } from './dto/webhook.dto';

/**
 * Single global Retell agent endpoint. One phone number → all verticals.
 *
 * HMAC guard (RetellWebhookGuard) is applied ONLY to /voice/webhook because
 * Retell signs lifecycle events but does NOT sign custom function-tool calls
 * (/voice/tools/*). Applying the guard to the whole controller blocks every
 * tool call with "Missing Retell signature".
 *
 * TenantInterceptor is kept so AsyncLocalStorage is initialised, but
 * @SkipTenant() tells it to set bypassTenant=true instead of resolving a
 * tenant from the agent_id.
 *
 * Tenant context is derived per-request from the provider_id the AI passes
 * back after calling find_providers. This means:
 *   1. find_providers  — searches all tenants globally
 *   2. hold_slot       — uses provider_id to derive tenant
 *   3. confirm_booking — same
 */
@Controller('voice')
@Public()
@SkipThrottle()
@SkipTransform()
@SkipTenant()
@UseInterceptors(TenantInterceptor)
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(private readonly voiceService: VoiceService) {}

  // ─── Call lifecycle webhook ──────────────────────────────────────────────

  @Post('webhook')
  @UseGuards(RetellWebhookGuard)
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: RetellWebhookDto) {
    const { event, call } = body;

    try {
      if (event === 'call_started') {
        await this.voiceService.handleCallStarted(
          call.call_id,
          call.agent_id,
          call.from_number ?? 'unknown',
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
      this.logger.error(
        `Webhook error for event ${event} / call ${call.call_id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    return { received: true };
  }

  // ─── Tools ───────────────────────────────────────────────────────────────

  @Post('tools/get-subjects')
  @HttpCode(HttpStatus.OK)
  async getSubjects(@Body() body: GetSubjectsToolDto) {
    try {
      // Retell nests params under args; fall back to top-level for direct calls.
      const p = body.args ?? body;
      const phone = p.phone ?? body.call?.from_number || `webcall:${body.call?.call_id}`;
      return await this.voiceService.getSubjects(phone, p.provider_id);
    } catch (err) {
      this.logger.error(`get_subjects failed: ${err instanceof Error ? err.message : err}`);
      return { result: `I'm having trouble looking up your records right now.`, subjects: [] };
    }
  }

  @Post('tools/find-providers')
  @HttpCode(HttpStatus.OK)
  async findProviders(@Body() body: FindProvidersToolDto) {
    // Retell nests params under args; fall back to top-level for direct calls.
    const p = body.args ?? body;
    this.logger.log(`find_providers called — postal_code="${p.postal_code}" vertical_slug="${p.vertical_slug}" preferred_date="${p.preferred_date}" raw_body=${JSON.stringify(body)}`);
    try {
      const result = await this.voiceService.findProviders(
        p.postal_code,
        p.vertical_slug,
        p.preferred_date,
      );
      this.logger.log(`find_providers result — options=${result.options?.length ?? 0} result="${result.result}"`);
      return result;
    } catch (err) {
      this.logger.error(`find_providers failed: ${err instanceof Error ? err.message : err}`);
      return { result: `I'm having trouble searching for providers right now. Could you give me a moment?`, options: [] };
    }
  }

  @Post('tools/hold-slot')
  @HttpCode(HttpStatus.OK)
  async holdSlot(@Body() body: HoldSlotToolDto) {
    try {
      const p = body.args ?? body;
      // Web calls have no from_number — use call_id as a stable per-session identifier.
      const phone = body.call?.from_number || `webcall:${body.call?.call_id}`;
      if (!p.slot_id || !p.provider_id) {
        return { result: `I'm missing the slot or provider details. Let me search again.`, slot_id: null };
      }
      return await this.voiceService.holdSlot(p.slot_id, p.provider_id, phone);
    } catch (err) {
      this.logger.error(`hold_slot failed: ${err instanceof Error ? err.message : err}`);
      return { result: `I couldn't hold that slot right now. Let me find you another option.`, slot_id: null };
    }
  }

  @Post('tools/confirm-booking')
  @HttpCode(HttpStatus.OK)
  async confirmBooking(@Body() body: ConfirmBookingToolDto) {
    try {
      const p = body.args ?? body;
      const phone = body.call?.from_number || `webcall:${body.call?.call_id}`;
      if (!p.slot_id || !p.provider_id) {
        return { result: `I'm missing the slot or provider details. Let me search again.`, booking_id: null, slot_id: null };
      }
      return await this.voiceService.confirmBooking(
        p.slot_id,
        p.provider_id,
        phone,
        p.subject_id,
        p.extra_fields,
        p.notes,
      );
    } catch (err) {
      this.logger.error(`confirm_booking failed: ${err instanceof Error ? err.message : err}`);
      return { result: `I couldn't confirm that booking. Let me try again.`, booking_id: null, slot_id: (body.args ?? body).slot_id };
    }
  }
}
