/**
 * Pure helpers for the Bandeja de entrada screen (WO-295): relative time, "days since received"
 * urgency, candidate ranking and id allocation for feedback registered or triaged locally.
 * Every relative caption here reads the demo's single frozen «ahora» (`src/data/demoClock.ts`, WO-674)
 * by default: the screen never follows the real calendar, just like Planta and Drift.
 */
import { referenceNow, type InboxItem } from '../../data';
import { daysSince as daysSinceAt, formatRelativeDaysOnly } from '../../lib/format-date';

/** Whole days elapsed since `receivedAt`, against the demo's frozen «ahora» by default. */
export function daysSince(receivedAt: string, now: Date = referenceNow()): number {
  return daysSinceAt(receivedAt, now);
}

/** `hoy`, `hace 1 d`, `hace 3 d`… the compact relative badge next to the source. */
export function formatRelativeDays(receivedAt: string, now: Date = referenceNow()): string {
  return formatRelativeDaysOnly(receivedAt, now);
}

/** Feedback is considered overdue for triage past this many days (andon styling kicks in). */
const OVERDUE_DAYS = 2;

export function isOverdue(receivedAt: string, now: Date = referenceNow()): boolean {
  return daysSince(receivedAt, now) > OVERDUE_DAYS;
}

export interface RankedCandidate {
  readonly featureId: string;
  readonly score: number;
  readonly reason: string;
  readonly isBestMatch: boolean;
}

/** Candidates sorted by score descending, with the top one flagged as "Mejor coincidencia". */
export function rankCandidates(item: InboxItem): readonly RankedCandidate[] {
  const sorted = [...item.candidates].sort((a, b) => b.score - a.score);
  return sorted.map((candidate, index) => ({ ...candidate, isBestMatch: index === 0 }));
}

function nextSequentialId(prefix: string, existingIds: readonly string[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const numbers = existingIds.map((id) => Number(pattern.exec(id)?.[1])).filter((value) => !Number.isNaN(value));
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

export function nextFeedbackId(existingItems: readonly InboxItem[]): string {
  return nextSequentialId('FB', existingItems.map((item) => item.id));
}

export function nextFeatureRequestId(existingFeatureIds: readonly string[]): string {
  return nextSequentialId('FR', existingFeatureIds);
}

/** `0,92`: the score with a comma decimal separator, as shown in canvas/Entrada.dc.html. */
export function formatScore(score: number): string {
  return score.toFixed(2).replace('.', ',');
}
