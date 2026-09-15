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
