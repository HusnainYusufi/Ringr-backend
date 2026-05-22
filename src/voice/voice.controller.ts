import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { VoiceService } from './voice.service';
import { RetellWebhookGuard } from '../common/guards/retell-webhook.guard';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { InjectRedis } from '../redis/redis.decorator';
import {
  SendOtpToolDto,
  VerifyOtpToolDto,
  GetSubjectsToolDto,
  FindProvidersToolDto,
  HoldSlotToolDto,
  ConfirmBookingToolDto,
} from './dto/voice-tool.dto';
import { RetellWebhookDto } from './dto/webhook.dto';
import { Tenant } from '@prisma/client';
import type Redis from 'ioredis';

// All voice endpoints are public (JWT doesn't apply — Retell uses HMAC)
// The RetellWebhookGuard verifies the HMAC signature instead

@Controller('voice')
@Public()
// HMAC-authenticated webhooks from a small pool of Retell IPs — IP-based
// throttling would either be ineffective (Retell shares egress) or starve
// legitimate traffic during multi-tool calls.
@SkipThrottle()
@UseGuards(RetellWebhookGuard)
@UseInterceptors(TenantInterceptor)
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ─── Call lifecycle webhook ─────────────────────────────────────────────

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: RetellWebhookDto, @CurrentTenant() tenant: Tenant) {
    const { event, call } = body;

    if (event === 'call_started') {
      await this.voiceService.handleCallStarted(
        call.call_id,
        call.agent_id,
        call.from_number ?? 'unknown',
        tenant.id,
      );
    }

    if (event === 'call_ended' || event === 'call_analyzed') {
      await this.voiceService.handleCallEnded(
        call.call_id,
        call.transcript,
        call.call_analysis?.call_summary,
        call.duration_ms,
      );
    }

    return { received: true };
  }

  // ─── Voice tool endpoints ───────────────────────────────────────────────

  @Post('tools/send-otp')
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() body: SendOtpToolDto, @CurrentTenant() tenant: Tenant) {
    const result = await this.voiceService.sendOtp(body.phone, tenant, this.redis);
    return { result };
  }

  @Post('tools/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: VerifyOtpToolDto, @CurrentTenant() tenant: Tenant) {
    const result = await this.voiceService.verifyOtp(body.phone, body.code, tenant, this.redis);
    return { result };
  }

  @Post('tools/get-subjects')
  @HttpCode(HttpStatus.OK)
  async getSubjects(@Body() body: GetSubjectsToolDto, @CurrentTenant() tenant: Tenant) {
    const result = await this.voiceService.getSubjects(body.customer_id, tenant);
    return { result };
  }

  @Post('tools/find-providers')
  @HttpCode(HttpStatus.OK)
  async findProviders(@Body() body: FindProvidersToolDto, @CurrentTenant() tenant: Tenant) {
    const result = await this.voiceService.findProviders(
      body.postal_code,
      tenant,
      body.vertical_slug,
      body.subject_type,
      body.visit_reason,
      body.preferred_date,
    );
    return { result };
  }

  @Post('tools/hold-slot')
  @HttpCode(HttpStatus.OK)
  async holdSlot(@Body() body: HoldSlotToolDto, @CurrentTenant() tenant: Tenant) {
    const result = await this.voiceService.holdSlot(body.slot_id, body.customer_id, tenant);
    return { result };
  }

  @Post('tools/confirm-booking')
  @HttpCode(HttpStatus.OK)
  async confirmBooking(@Body() body: ConfirmBookingToolDto, @CurrentTenant() tenant: Tenant) {
    const result = await this.voiceService.confirmBooking(
      body.slot_id,
      body.customer_id,
      tenant,
      body.subject_id,
      body.extra_fields,
      body.notes,
    );
    return { result };
  }
}
