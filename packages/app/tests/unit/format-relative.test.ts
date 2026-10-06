import { describe, expect, it } from 'vitest';
import { ageInDays, formatRelative } from '../../src/lib/format-relative.js';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** An instant `msAgo` before NOW, as the server would send it. */
const ago = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

describe('formatRelative (WO-633, SDD-069)', () => {
  it('says "hace instantes" for anything under a minute', () => {
    expect(formatRelative(ago(0), NOW)).toBe('hace instantes');
    expect(formatRelative(ago(MINUTE - 1), NOW)).toBe('hace instantes');
  });

  it('counts whole minutes under an hour', () => {
    expect(formatRelative(ago(MINUTE), NOW)).toBe('hace 1 min');
    expect(formatRelative(ago(59 * MINUTE + 59_000), NOW)).toBe('hace 59 min');
  });

  it('counts whole hours under a day', () => {
    expect(formatRelative(ago(HOUR), NOW)).toBe('hace 1 h');
    expect(formatRelative(ago(23 * HOUR + 59 * MINUTE), NOW)).toBe('hace 23 h');
  });

  it('counts whole days from a day up', () => {
    expect(formatRelative(ago(DAY), NOW)).toBe('hace 1 d');
    expect(formatRelative(ago(8 * DAY), NOW)).toBe('hace 8 d');
  });

  it('returns the raw string when the date cannot be read, never Invalid Date', () => {
    expect(formatRelative('no-es-una-fecha', NOW)).toBe('no-es-una-fecha');
  });
});

describe('ageInDays (WO-633, SDD-069)', () => {
  it('is 0 for anything under a day', () => {
    expect(ageInDays(ago(0), NOW)).toBe(0);
    expect(ageInDays(ago(DAY - 1), NOW)).toBe(0);
  });

  it('floors partial days', () => {
    expect(ageInDays(ago(DAY + HOUR), NOW)).toBe(1);
    expect(ageInDays(ago(2 * DAY - 1), NOW)).toBe(1);
  });

  it('walks the 7-day staleness edge the drift header reads', () => {
    expect(ageInDays(ago(6 * DAY), NOW)).toBe(6);
    expect(ageInDays(ago(7 * DAY), NOW)).toBe(7);
    expect(ageInDays(ago(8 * DAY), NOW)).toBe(8);
  });

  it('is 0 for an unreadable date or a future instant, never NaN or negative', () => {
    expect(ageInDays('no-es-una-fecha', NOW)).toBe(0);
    expect(ageInDays(ago(-2 * DAY), NOW)).toBe(0);
  });
});
