import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  // Lazy singleton — built once on module init so we don't construct a fresh
  // SMTP pool per email.
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const demoMode = this.config.get<boolean>('demoMode');
    if (demoMode) return; // No transporter in demo mode; sendEmail logs instead.

    const user = this.config.get<string>('smtp.user');
    const pass = this.config.get<string>('smtp.pass');
    if (!user || !pass) {
      this.logger.warn('SMTP_USER / SMTP_PASS not set — outbound email is disabled');
      return;
    }

    const service = this.config.get<string>('smtp.service');
    const host = this.config.get<string>('smtp.host');
    const port = this.config.get<number>('smtp.port');

    // If an explicit host is supplied, use it; otherwise fall back to the
    // `service:` shortcut (e.g. 'gmail').
    this.transporter = nodemailer.createTransport(
      host
        ? {
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
            tls: { rejectUnauthorized: false },
          }
        : {
            service,
            auth: { user, pass },
            tls: { rejectUnauthorized: false },
          },
    );
  }

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

    if (!this.transporter) {
      this.logger.warn(`Email NOT sent to ${payload.to} — SMTP not configured`);
      return;
    }

    const from = this.config.get<string>('smtp.fromEmail');
    const info = await this.transporter.sendMail({
      from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
    this.logger.log(`Email sent to ${payload.to} (id=${info.messageId})`);
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

  // ─── Email templates ──────────────────────────────────────────────────────

  buildOnboardingMagicLinkEmail(params: {
    providerName: string;
    ownerFirstName: string;
    magicLinkUrl: string;
    expiresAt: Date;
  }): { subject: string; html: string } {
    const { providerName, ownerFirstName, magicLinkUrl, expiresAt } = params;
    const expiry = new Intl.DateTimeFormat('en-CA', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'America/Toronto',
    }).format(expiresAt);

    const subject = `Welcome to Ringr — finish setting up ${providerName}`;
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">
        <h2 style="margin:0 0 16px;">Welcome to Ringr, ${escapeHtml(ownerFirstName)}.</h2>
        <p>You've been invited to manage <strong>${escapeHtml(providerName)}</strong> on Ringr.</p>
        <p>Click the link below to set your password and access your dashboard. It expires on ${escapeHtml(expiry)}.</p>
        <p style="margin:32px 0;">
          <a href="${magicLinkUrl}"
             style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
            Set up my account
          </a>
        </p>
        <p style="color:#555;font-size:13px;">If the button doesn't work, paste this URL into your browser:</p>
        <p style="color:#555;font-size:13px;word-break:break-all;">${magicLinkUrl}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:32px 0;" />
        <p style="color:#888;font-size:12px;">If you weren't expecting this, you can ignore this email.</p>
      </div>
    `;
    return { subject, html };
  }
}

// Minimal HTML escape — protects against names/strings injected from user data.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
