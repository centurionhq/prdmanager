import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from '../../src/lib/format-date.js';

describe('formatDate (WO-581, SDD-056)', () => {
  it('writes day, month and year, in that order', () => {
    expect(formatDate('2026-12-14T12:00:00.000Z')).toBe('14/12/2026');
  });

  it('pads day and month to two digits', () => {
    expect(formatDate('2026-03-05T12:00:00.000Z')).toBe('05/03/2026');
  });

  it('reads the instant in UTC, so the same token says the same day to everyone', () => {
    expect(formatDate('2026-12-14T23:59:59.999Z')).toBe('14/12/2026');
    expect(formatDate('2026-12-15T00:00:00.000Z')).toBe('15/12/2026');
  });
});

describe('formatDateTime (WO-633, SDD-069)', () => {
  it('writes day, month, year, hour and minute, in that order', () => {
    expect(formatDateTime('2026-09-27T18:21:56.000Z')).toBe('27/09/2026, 18:21');
  });

  it('keeps the 24-hour clock, like the rest of the app', () => {
    expect(formatDateTime('2026-09-27T06:21:00.000Z')).toBe('27/09/2026, 06:21');
  });

  it('pads hour and minute to two digits', () => {
    expect(formatDateTime('2026-03-05T04:05:00.000Z')).toBe('05/03/2026, 04:05');
  });

  it('reads the instant in UTC, so 23:59 UTC is still that day', () => {
    expect(formatDateTime('2026-12-14T23:59:59.999Z')).toBe('14/12/2026, 23:59');
    expect(formatDateTime('2026-12-15T00:00:00.000Z')).toBe('15/12/2026, 00:00');
  });
});
