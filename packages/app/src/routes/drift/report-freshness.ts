/**
 * Freshness of the official drift report (SDD-069, WO-634).
 *
 * Pure and React-free on purpose, same convention as `drift-groups.ts`: the screen decides *where* the age
 * and the warning go, this decides *whether the report is still trustworthy* and *what the age says*.
 *
 * `now` is a parameter and not `Date.now()` inside, because freshness is a function of two instants: the one
 * the server reported (`report.createdAt`) and the one we are reading it. Nothing here may derive age from a
 * fetch time (SDD-069 D1): a refetch does not rejuvenate a report, it only re-reads it.
 */
import { formatDateTime } from '../../lib/format-date.js';
import { ageInDays, formatRelative } from '../../lib/format-relative.js';

/**
 * A week. The official report is pushed by CI on every push to the default branch, so seven days without a
 * fresh one means either the pipeline stopped or the project went quiet; in both cases the number on screen
 * stopped being reliable. This is a product decision, so it lives here as the single exported constant and is
 * never written as a literal in the JSX.
 */
export const REPORT_STALE_AFTER_DAYS = 7;

export interface ReportFreshness {
  /** Complete days since the report was created; `0` for anything younger than a day. */
  readonly days: number;
  /** Human age — `hace 8 d` — for the subtitle. */
  readonly relative: string;
  /** The exact instant — `09/01/2026, 05:00` — for the tooltip. */
  readonly absolute: string;
  /** `days >= REPORT_STALE_AFTER_DAYS`: the report is old enough that the numbers may not match the code. */
  readonly stale: boolean;
}

export function reportFreshness(iso: string, now: number = Date.now()): ReportFreshness {
  const days = ageInDays(iso, now);
  return {
    days,
    relative: formatRelative(iso, now),
    absolute: formatDateTime(iso),
    stale: days >= REPORT_STALE_AFTER_DAYS,
  };
}
