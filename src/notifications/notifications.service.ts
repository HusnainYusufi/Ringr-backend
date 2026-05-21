import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SmsPayload {
  to: string;
  body: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendSms(payload: SmsPayload): Promise<void> {
    const demoMode = this.config.get<boolean>('demoMode');

    if (demoMode) {
      this.logger.debug(`[DEMO SMS] To: ${payload.to} | Body: ${payload.body}`);
      return;
    }

    const accountSid = this.config.get<string>('twilio.accountSid');
    const authToken = this.config.get<string>('twilio.authToken');
    const from = this.config.get<string>('twilio.fromNumber');

    const twilio = require('twilio')(accountSid, authToken);
    await twilio.messages.create({ to: payload.to, from, body: payload.body });
    this.logger.log(`SMS sent to ${payload.to}`);
  }

  async sendEmail(payload: EmailPayload): Promise<void> {
    const demoMode = this.config.get<boolean>('demoMode');

    if (demoMode) {
      this.logger.debug(`[DEMO EMAIL] To: ${payload.to} | Subject: ${payload.subject}`);
      return;
    }

    const apiKey = this.config.get<string>('resend.apiKey');
    const from = this.config.get<string>('resend.fromEmail');

    const { Resend } = require('resend');
    const resend = new Resend(apiKey);

    await resend.emails.send({
      from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
    this.logger.log(`Email sent to ${payload.to}`);
  }

  // ─── SMS templates (vertical-aware) ───────────────────────────────────────

  buildBookingConfirmationSms(
    providerName: string,
    dateStr: string,
    providerAddress: string,
    appointmentLabel = 'appointment',
  ): string {
    return `Your ${appointmentLabel} at ${providerName} is confirmed for ${dateStr}. Address: ${providerAddress}. Reply CANCEL to cancel.`;
  }

  buildReminderSms(
    providerName: string,
    dateStr: string,
    hoursAhead: number,
    appointmentLabel = 'appointment',
  ): string {
    return `Reminder: Your ${appointmentLabel} at ${providerName} is in ${hoursAhead} hour${hoursAhead !== 1 ? 's' : ''} — ${dateStr}.`;
  }

  buildCancellationSms(providerName: string, appointmentLabel = 'appointment'): string {
    return `Your ${appointmentLabel} at ${providerName} has been cancelled. Call us to rebook.`;
  }
}
