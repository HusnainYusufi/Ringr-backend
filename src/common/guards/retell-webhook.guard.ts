import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class RetellWebhookGuard implements CanActivate {
  private readonly logger = new Logger(RetellWebhookGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers['x-retell-signature'] as string;
    const webhookSecret = this.configService.get<string>('retell.webhookSecret');

    if (!webhookSecret) {
      // Fail closed in production. A missing secret is a deployment misconfiguration,
      // not a free pass — silently allowing requests would let anyone forge webhook
      // traffic from the public internet.
      if (this.configService.get<string>('nodeEnv') === 'production') {
        this.logger.error('RETELL_WEBHOOK_SECRET not set in production — rejecting webhook');
        throw new UnauthorizedException('Webhook verification not configured');
      }
      this.logger.warn('RETELL_WEBHOOK_SECRET not set — skipping HMAC verification (non-production only)');
      return true;
    }

    if (!signature) {
      throw new UnauthorizedException('Missing Retell signature');
    }

    const rawBody: Buffer = request.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException('Raw body not available for HMAC verification');
    }

    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid Retell signature');
    }

    return true;
  }
}
