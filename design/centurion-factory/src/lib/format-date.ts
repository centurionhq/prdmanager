/**
 * Shared date and relative-time formatting primitives (es-AR locale), used to be duplicated across
 * ~10 feature files (drift-format.ts, ordenes/format.ts, arbol/traceability.ts, ajustes/lib.ts,
 * planta-format.ts, documentos/helpers.ts, proyectos/lib.ts, entrada/lib.ts, documento/format.ts,
 * documento/VersionsTab.tsx). Each screen's wrapper composes these primitives to reproduce its own
 * exact original copy: the screens don't all agree on rounding, "now"/"ayer" wording or how far
 * back a relative caption reaches before falling back to an absolute date, so this module keeps the
 * distinct algorithms as separate named functions rather than forcing one shape on every caller.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `28/08/2026`, UTC-based dd/mm/yyyy — the absolute date format used across most screens. */
export function formatDateEs(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

const INTL_DATE_ES_AR = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** `28/08/2026` via `Intl.DateTimeFormat` in the runtime's local timezone (Drift/Planta's original). */
export function formatDateEsIntl(iso: string): string {
  return INTL_DATE_ES_AR.format(new Date(iso));
}

/** `dd/mm/yyyy, HH:mm`, es-AR, local timezone — for timestamps that also need the time of day. */
export function formatDateTimeEs(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** `yyyy-mm-dd`, UTC — matches plain date-only fields (no time component). */
export function toDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function isSameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export interface RelativeCappedOptions {
  readonly now?: Date;
  readonly nowLabel?: string;
}

/**
 * "hace N min" / "hace N h" / "hace N d", rounding at each step, with no absolute-date fallback.
 * Matches Drift's and Planta's original identical `formatRelativeTime`.
 */
export function formatRelativeCapped(iso: string, options: RelativeCappedOptions = {}): string {
  const now = options.now ?? new Date();
  const nowLabel = options.nowLabel ?? 'justo ahora';
  const diffMinutes = Math.round((now.getTime() - new Date(iso).getTime()) / MINUTE_MS);
  if (diffMinutes < 1) return nowLabel;
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;

  return `hace ${Math.round(diffHours / 24)} d`;
}

export interface RelativeWithWeekFallbackOptions {
  readonly now?: Date;
  readonly nowLabel?: string;
}

/**
 * "hace N min" / "hace N h" / "hace N d" (rounding), falling back to `formatDateEs` past a week.
 * Matches Ajustes' original `formatRelativeAccess`.
 */
export function formatRelativeWithWeekFallback(iso: string, options: RelativeWithWeekFallbackOptions = {}): string {
  const now = options.now ?? new Date();
  const nowLabel = options.nowLabel ?? 'Ahora';
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();

  if (diffMs < MINUTE_MS) return nowLabel;
  if (diffMs < HOUR_MS) return `hace ${Math.round(diffMs / MINUTE_MS)} min`;
  if (diffMs < DAY_MS) return `hace ${Math.round(diffMs / HOUR_MS)} h`;
  if (diffMs < WEEK_MS) return `hace ${Math.round(diffMs / DAY_MS)} d`;
  return formatDateEs(iso);
}

export interface RelativeCalendarOptions {
  readonly now?: Date;
  readonly nowLabel?: string;
}

/**
 * "ahora" / "hace N min" / "hace N h" / "ayer" / "hace N d" / absolute date, using calendar-day
 * boundaries (not rolling 24h windows) for "hoy" vs "ayer". Matches Proyectos' original
 * `formatRelativeActivity`.
 */
export function formatRelativeCalendar(iso: string, options: RelativeCalendarOptions = {}): string {
  const now = options.now ?? new Date();
  const nowLabel = options.nowLabel ?? 'ahora';
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();

  if (diffMs < MINUTE_MS) return nowLabel;
  if (diffMs < HOUR_MS) return `hace ${Math.round(diffMs / MINUTE_MS)} min`;
  if (isSameUtcDay(then, now)) return `hace ${Math.round(diffMs / HOUR_MS)} h`;

  const yesterday = new Date(now.getTime() - DAY_MS);
  if (isSameUtcDay(then, yesterday)) return 'ayer';
  if (diffMs < WEEK_MS) return `hace ${Math.round(diffMs / DAY_MS)} d`;

  return formatDateEs(iso);
}

export interface RelativeRollingOptions {
  readonly now?: Date;
}

/**
 * "hace N min" / "hace N h" / "ayer" / an absolute short date, using rolling 24h/48h windows
 * (not calendar days) and flooring instead of rounding. Matches Documentos' original
 * `formatUpdated`; falls back to `Date#toLocaleDateString` (local timezone) past 2 days, exactly
 * like the original.
 */
export function formatRelativeRolling(iso: string, options: RelativeRollingOptions = {}): string {
  const now = options.now ?? new Date();
  const diffMs = Math.max(0, now.getTime() - new Date(iso).getTime());

  if (diffMs < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(diffMs / MINUTE_MS));
    return `hace ${minutes} min`;
  }
  if (diffMs < DAY_MS) return `hace ${Math.floor(diffMs / HOUR_MS)} h`;
  if (diffMs < 2 * DAY_MS) return 'ayer';
  return new Date(iso).toLocaleDateString('es-AR');
}

export interface RelativeHoursOnlyOptions {
  readonly now?: Date;
}

/**
 * "hace N min" / "hace N h" only, flooring, never reaching days. Matches Documento's original
 * `formatRelative` (comments and agent proposals, whose demo data never spans a day).
 */
export function formatRelativeHoursOnly(iso: string, options: RelativeHoursOnlyOptions = {}): string {
  const now = options.now ?? new Date();
  const diffMs = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (diffMs < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(diffMs / MINUTE_MS));
    return `hace ${minutes} min`;
  }
  return `hace ${Math.floor(diffMs / HOUR_MS)} h`;
}

/** Whole days elapsed since `iso`, floored (never negative). */
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS));
}

/** "hoy" / "hace N d" — whole-day granularity only. Matches Entrada's original `formatRelativeDays`. */
export function formatRelativeDaysOnly(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now);
  return days === 0 ? 'hoy' : `hace ${days} d`;
}
