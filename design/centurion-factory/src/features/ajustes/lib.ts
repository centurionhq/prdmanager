/** Small formatting helpers shared by the Ajustes screens (WO-305/306/307). */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `dd/mm/yyyy`, always read in UTC so it matches the `Z`-suffixed mock timestamps. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** Relative "last access" label; falls back to an absolute date past a week. */
export function formatRelativeAccess(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();

  if (diffMs < MINUTE_MS) return 'Ahora';
  if (diffMs < HOUR_MS) return `hace ${Math.round(diffMs / MINUTE_MS)} min`;
  if (diffMs < DAY_MS) return `hace ${Math.round(diffMs / HOUR_MS)} h`;
  if (diffMs < WEEK_MS) return `hace ${Math.round(diffMs / DAY_MS)} d`;
  return formatDate(iso);
}

const HEX_CHARS = '0123456789abcdef';

function randomHex(length: number): string {
  return Array.from({ length }, () => HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)]).join('');
}

/** A mock CI token secret: `prdm_ci_<4 hex>` prefix plus 24 more hex characters. */
export function generateTokenSecret(): { readonly prefix: string; readonly secret: string } {
  const prefix = `prdm_ci_${randomHex(4)}`;
  return { prefix, secret: `${prefix}${randomHex(24)}` };
}

/** `YYYY-MM-DD`, matching the plain date strings CiToken.createdAt/expiresAt use. */
export function toDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export const CLIPBOARD_ERROR = 'No pudimos copiar. Seleccioná el texto y copialo a mano.';

/**
 * Copies `text` to the clipboard, tolerating a missing `navigator.clipboard` (insecure context,
 * unsupported browser) or a rejected `writeText` (denied permission). Never throws.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
