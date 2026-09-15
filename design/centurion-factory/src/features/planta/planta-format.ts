/**
 * Number formatting for the Planta page (WO-282), es-AR locale (decimal comma), plus this screen's
 * relative-time wrapper around the shared helper in `src/lib/format-date.ts`.
 * `NOW_ISO` is the fixed "now" behind every "hace N" caption in this mock demo: it lines up with
 * report-001's `createdAt` (09:56) so the header reads "hace 4 min", exactly as the canvas commits to.
 */
import { formatRelativeCapped } from '../../lib/format-date';

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

/** "hace 4 min" / "hace 1 h" / "hace 3 d", relative to `now` (defaults to the fixed demo "now"). */
export function formatRelativeTime(iso: string, now: Date = referenceNow()): string {
  return formatRelativeCapped(iso, { now });
}
