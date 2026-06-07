import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';

/**
 * Issues a Retell web-call access token so the browser-based demo can connect
 * directly to the AI agent without a real phone number.
 *
 * Deliberately separated from VoiceController so this endpoint does NOT need
 * the RetellWebhookGuard (HMAC auth is irrelevant for browser-initiated calls).
 */
@Controller('voice')
@Public()
@SkipThrottle()
export class WebCallController {
  private readonly logger = new Logger(WebCallController.name);

  constructor(private readonly config: ConfigService) {}

  @Post('web-call')
  @HttpCode(HttpStatus.OK)
  async createWebCall() {
    const agentId = this.config.get<string>('retell.agentId');
    const apiKey = this.config.get<string>('retell.apiKey');

    if (!agentId || !apiKey) {
      throw new InternalServerErrorException('Retell agent not configured');
    }

    const res = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agent_id: agentId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      this.logger.error(`Retell web-call creation failed: ${JSON.stringify(err)}`);
      throw new InternalServerErrorException('Failed to start web call');
    }

    const data = await res.json();
    return { data: { accessToken: data.access_token, callId: data.call_id } };
  }
}
