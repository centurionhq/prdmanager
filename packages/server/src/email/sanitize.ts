/**
 * Shared sanitization for any user-controlled value (user/org names) interpolated into an email
 * (SDD-006 §Autenticación: "Nombres de organización y usuario se escapan en HTML y se les quitan
 * CR/LF en los emails"). Used for reset-password emails now (WO-096); invitation emails (a later WO)
 * reuse the same two functions.
 */

/** Strips carriage returns and line feeds so a name can never inject extra lines/headers wherever
 * it ends up (SMTP body or, if this were reused near a header context, the header itself). */
export function stripCrLf(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

/** CR/LF-stripped and HTML-escaped, ready to interpolate into an HTML email body. */
export function sanitizeNameForHtml(value: string): string {
  return escapeHtml(stripCrLf(value));
}

/** CR/LF-stripped only, ready to interpolate into a plain-text email body. */
export function sanitizeNameForText(value: string): string {
  return stripCrLf(value);
}
