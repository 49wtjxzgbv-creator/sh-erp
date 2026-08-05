import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Thin SMTP wrapper (Module 12) — the v2 replacement for the legacy
 * `MailApp.sendEmail` (Automation.gs), which relied on Apps Script's Google
 * Workspace account for delivery and needed no configuration at all. A real
 * server needs SMTP credentials somewhere; this reads them from env vars
 * (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`) rather than
 * hardcoding a provider, so any SMTP-speaking service (Postmark, SES SMTP
 * interface, Mailgun, a real mailbox) works without a code change.
 *
 * If SMTP isn't configured (local dev, or a fresh deploy before the owner
 * has set it up), sending logs the message instead of throwing — a
 * digest/notification feature failing open (log-only) is the right default
 * for a non-critical, best-effort channel; nothing in this codebase's
 * request/response cycle depends on an email actually landing.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  private getTransporter(): nodemailer.Transporter | null {
    if (this.transporter) return this.transporter;
    const host = process.env.SMTP_HOST;
    if (!host) return null;

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    return this.transporter;
  }

  async send(to: string, subject: string, text: string): Promise<{ sent: boolean }> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn(`SMTP_HOST not configured — logging email instead of sending. To: ${to}, Subject: ${subject}`);
      this.logger.log(text);
      return { sent: false };
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'SH ERP <no-reply@sh-erp.local>',
      to,
      subject,
      text,
    });
    return { sent: true };
  }
}
