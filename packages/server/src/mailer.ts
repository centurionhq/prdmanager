/**
 * `Mailer` port (SDD-006 §Autenticación / WO-096): every place this server sends email goes through
 * this interface, injected into `buildServer`/`buildAuth` deps. `FakeMailer` captures messages for
 * tests; a real nodemailer-backed implementation lands with WO-096, which also builds the actual
 * reset-password email content (HTML-escaped, CR/LF-stripped names).
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  sendMail(message: MailMessage): Promise<void>;
}

/** In-memory `Mailer` for tests: every call to `sendMail` is captured in `messages`, in order. */
export class FakeMailer implements Mailer {
  public readonly messages: MailMessage[] = [];

  async sendMail(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }
}
