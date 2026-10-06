import { describe, expect, it } from 'vitest';
import { formatDate } from '../../src/lib/format-date.js';

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
