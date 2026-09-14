/**
 * The reset-password email (SDD-006 §Autenticación, WO-096): built with the fixed `PRDM_PUBLIC_URL`
 * (never a request `Host` — better-auth's own `url` is already rooted there, see
 * `../auth/build-auth.ts`), with the user's name HTML-escaped and CR/LF-stripped in both bodies.
 */
import type { MailMessage } from '../mailer.js';
import { escapeHtml, sanitizeNameForHtml, sanitizeNameForText } from './sanitize.js';

export interface ResetPasswordEmailInput {
  userName: string;
  userEmail: string;
  url: string;
}

export function buildResetPasswordEmail(input: ResetPasswordEmailInput): MailMessage {
  const safeUrl = escapeHtml(input.url);
  const nameForText = sanitizeNameForText(input.userName);
  const nameForHtml = sanitizeNameForHtml(input.userName);

  const text = [`Hi ${nameForText},`, '', 'Reset your prdm password using the link below:', '', input.url, '', "If you didn't request this, you can safely ignore this email."].join(
    '\n',
  );

  const html = [
    `<p>Hi ${nameForHtml},</p>`,
    '<p>Reset your prdm password using the link below:</p>',
    `<p><a href="${safeUrl}">${safeUrl}</a></p>`,
    "<p>If you didn't request this, you can safely ignore this email.</p>",
  ].join('\n');

  return {
    to: input.userEmail,
    subject: 'Reset your prdm password',
    text,
    html,
  };
}
