/**
 * Number formatting for the Planta page (WO-282), es-AR locale (decimal comma), plus this screen's
 * relative-time wrapper around the shared helper in `src/lib/format-date.ts`.
 * `NOW_ISO` is the demo's single frozen «ahora» (WO-674): it lives in `src/data/demoClock.ts` and is
 * re-exported here so this screen's callers keep their import. It lines up with report-001's
 * `createdAt` (09:56) so the header reads "hace 4 min", exactly as the canvas commits to.
 */
import { DEMO_NOW_ISO, referenceNow } from '../../data';
import { formatRelativeCapped } from '../../lib/format-date';

export { DEMO_NOW_ISO as NOW_ISO, referenceNow };

const PERCENT_FORMATTER = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

/** "99,6 %", "100 %" — trims the trailing zero for whole numbers. */
export function formatPercent(value: number): string {
  return `${PERCENT_FORMATTER.format(value)} %`;
}

/** Hours to whole minutes: 0.09 h → "5 min". */
export function formatMedianResolution(hours: number): string {
  return `${Math.round(hours * 60)} min`;
}

const HOURS_FORMATTER = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const HOURS_PER_DAY = 24;

/** SDD-094 (WO-720) D5: "17,4 d" from 48 h on, "47,5 h" below — the app's own rule, word for word. */
export function formatHours(hours: number): string {
  return hours >= HOURS_PER_DAY * 2 ? `${HOURS_FORMATTER.format(hours / HOURS_PER_DAY)} d` : `${HOURS_FORMATTER.format(hours)} h`;
}

/** SDD-094: the queue threshold as copy ("más de un día" for the 24 h default). */
export function slowThresholdCopy(thresholdHours: number): string {
  return thresholdHours === HOURS_PER_DAY ? 'más de un día' : `más de ${formatHours(thresholdHours)}`;
}

/** "hace 4 min" / "hace 1 h" / "hace 3 d", relative to `now` (defaults to the fixed demo "now"). */
export function formatRelativeTime(iso: string, now: Date = referenceNow()): string {
  return formatRelativeCapped(iso, { now });
}
