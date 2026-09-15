/**
 * Number and relative-time formatting for the Planta page (WO-282), es-AR locale (decimal comma).
 * `NOW_ISO` is the fixed "now" behind every "hace N" caption in this mock demo: it lines up with
 * report-001's `createdAt` (09:56) so the header reads "hace 4 min", exactly as the canvas commits to.
 */
export const NOW_ISO = '2026-09-15T10:00:00.000Z';

export function referenceNow(): Date {
  return new Date(NOW_ISO);
}

const PERCENT_FORMATTER = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

/** "99,6 %", "100 %" — trims the trailing zero for whole numbers. */
export function formatPercent(value: number): string {
  return `${PERCENT_FORMATTER.format(value)} %`;
}

/** Hours to whole minutes: 0.09 h → "5 min". */
export function formatMedianResolution(hours: number): string {
  return `${Math.round(hours * 60)} min`;
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
