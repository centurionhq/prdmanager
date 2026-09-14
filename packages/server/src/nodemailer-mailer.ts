/**
 * `Mailer` backed by nodemailer 10.0.9's SMTP transport (SDD-006 §Autenticación, WO-096): mailpit in
 * dev, real SMTP in production, both configured from `env.smtp` (see `./env.ts`). `FakeMailer`
 * (`./mailer.ts`) is what tests use instead.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type { SmtpEnv } from './env.js';
import type { Mailer, MailMessage } from './mailer.js';

export class NodemailerMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(smtp: SmtpEnv) {
    this.from = smtp.from;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }

  async sendMail(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
