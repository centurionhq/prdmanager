/**
 * Number and percent formatting for the Drift page (WO-293/294), es-AR locale, plus this screen's
 * date/relative-time wrappers around the shared helpers in `src/lib/format-date.ts`.
 * `NOW_ISO` matches the one in `../planta/planta-format.ts` so every "hace N" caption across the
 * app agrees: report-001 (headSha 8f2c1d4) was created at 09:56, hence "hace 4 min" at 10:00.
 */
import { formatDateEsIntl, formatRelativeCapped } from '../../lib/format-date';

export const NOW_ISO = '2026-09-15T10:00:00.000Z';

export function referenceNow(): Date {
  return new Date(NOW_ISO);
}

const INTEGER_FORMATTER = new Intl.NumberFormat('es-AR');
const PERCENT_FORMATTER = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

/** "3.254" — es-AR thousands separator. */
export function formatCount(value: number): string {
  return INTEGER_FORMATTER.format(value);
}

/** "99,6 %", "100 %" — trims the trailing zero for whole numbers. */
export function formatPercent(value: number): string {
  return `${PERCENT_FORMATTER.format(value)} %`;
}

/** "15/09/2026". */
export function formatDate(iso: string): string {
  return formatDateEsIntl(iso);
}

/** "hace 4 min" / "hace 1 h" / "hace 3 d", relative to `now` (defaults to the fixed demo "now"). */
export function formatRelativeTime(iso: string, now: Date = referenceNow()): string {
  return formatRelativeCapped(iso, { now });
}
