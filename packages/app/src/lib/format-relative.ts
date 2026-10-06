/**
 * Human age of an instant — `hace 8 d`, `hace 3 h` — for the drift screen (SDD-069, WO-633).
 *
 * Pure and React-free on purpose: the component decides *where* the age is shown, this decides *what it says*,
 * and the tests can walk every bracket by passing `now`.
 *
 * `now` is a parameter and not `Date.now()` inside, because freshness is a function of two instants: the one
 * the server reported (`report.createdAt`) and the one we are reading it. The screen must never derive age from
 * a fetch time (SDD-069 D1) — a refetch does not rejuvenate a report.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `hace instantes` | `hace N min` | `hace N h` | `hace N d`. An unparseable date comes back verbatim: a raw
 * ISO is wrong-looking but diagnosable, an `Invalid Date` on screen is not. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const elapsed = now - then;
  if (elapsed < MINUTE) return 'hace instantes';
  if (elapsed < HOUR) return `hace ${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `hace ${Math.floor(elapsed / HOUR)} h`;
  return `hace ${Math.floor(elapsed / DAY)} d`;
}

/** Complete days elapsed, `0` for anything under a day (or an unparseable date). Never negative: a future
 * instant has no age yet, and the 7-day staleness threshold reads this as "fresh". */
export function ageInDays(iso: string, now: number = Date.now()): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / DAY));
}
