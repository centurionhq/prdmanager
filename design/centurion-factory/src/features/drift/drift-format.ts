/**
 * Number, date and relative-time formatting for the Drift page (WO-293/294), es-AR locale.
 * `NOW_ISO` matches the one in `../planta/planta-format.ts` so every "hace N" caption across the
 * app agrees: report-001 (headSha 8f2c1d4) was created at 09:56, hence "hace 4 min" at 10:00.
 */
export const NOW_ISO = '2026-09-15T10:00:00.000Z';

export function referenceNow(): Date {
  return new Date(NOW_ISO);
}

const INTEGER_FORMATTER = new Intl.NumberFormat('es-AR');
const PERCENT_FORMATTER = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const DATE_FORMATTER = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

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
  return DATE_FORMATTER.format(new Date(iso));
}

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** "hace 4 min" / "hace 1 h" / "hace 3 d", relative to `now` (defaults to the fixed demo "now"). */
export function formatRelativeTime(iso: string, now: Date = referenceNow()): string {
  const diffMinutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (diffMinutes < 1) return 'justo ahora';
  if (diffMinutes < MINUTES_PER_HOUR) return `hace ${diffMinutes} min`;

  const diffHours = Math.round(diffMinutes / MINUTES_PER_HOUR);
  if (diffHours < HOURS_PER_DAY) return `hace ${diffHours} h`;

  const diffDays = Math.round(diffHours / HOURS_PER_DAY);
  return `hace ${diffDays} d`;
}
