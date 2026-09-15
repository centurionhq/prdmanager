import { describe, expect, it } from 'vitest';
import {
  daysSince,
  formatDateEs,
  formatDateEsIntl,
  formatDateTimeEs,
  formatRelativeCalendar,
  formatRelativeCapped,
  formatRelativeDaysOnly,
  formatRelativeHoursOnly,
  formatRelativeRolling,
  formatRelativeWithWeekFallback,
  isSameUtcDay,
  toDateOnly,
} from '../../src/lib/format-date';

describe('formatDateEs', () => {
  it('formats an ISO timestamp as UTC dd/mm/yyyy', () => {
    expect(formatDateEs('2026-08-28T15:32:02.636Z')).toBe('28/08/2026');
  });

  it('pads single-digit day and month', () => {
    expect(formatDateEs('2026-01-05T00:00:00.000Z')).toBe('05/01/2026');
  });
});

describe('formatDateEsIntl', () => {
  it('formats an ISO timestamp as dd/mm/yyyy via Intl', () => {
    expect(formatDateEsIntl('2026-08-28T15:32:02.636Z')).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });
});

describe('formatDateTimeEs', () => {
  it('includes the date and the time of day', () => {
    const result = formatDateTimeEs('2026-08-28T15:32:00.000Z');
    expect(result).toMatch(/^28\/08\/2026, \d{2}:\d{2}/);
  });
});

describe('toDateOnly', () => {
  it('formats a Date as UTC yyyy-mm-dd', () => {
    expect(toDateOnly(new Date('2026-03-04T12:00:00.000Z'))).toBe('2026-03-04');
  });
});

describe('isSameUtcDay', () => {
  it('is true for two timestamps on the same UTC calendar day', () => {
    expect(isSameUtcDay(new Date('2026-09-15T01:00:00.000Z'), new Date('2026-09-15T23:00:00.000Z'))).toBe(true);
  });

  it('is false across a UTC day boundary', () => {
    expect(isSameUtcDay(new Date('2026-09-15T23:59:00.000Z'), new Date('2026-09-16T00:01:00.000Z'))).toBe(false);
  });
});

describe('formatRelativeCapped', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');

  it('returns the now label under a minute', () => {
    expect(formatRelativeCapped('2026-09-15T09:59:59.000Z', { now })).toBe('justo ahora');
  });

  it('formats minutes under an hour', () => {
    expect(formatRelativeCapped('2026-09-15T09:56:00.000Z', { now })).toBe('hace 4 min');
  });

  it('formats hours under a day', () => {
    expect(formatRelativeCapped('2026-09-15T04:00:00.000Z', { now })).toBe('hace 6 h');
  });

  it('formats days with no absolute-date fallback', () => {
    expect(formatRelativeCapped('2026-09-10T10:00:00.000Z', { now })).toBe('hace 5 d');
  });

  it('accepts a custom now label', () => {
    expect(formatRelativeCapped('2026-09-15T09:59:59.000Z', { now, nowLabel: 'recién' })).toBe('recién');
  });
});

describe('formatRelativeWithWeekFallback', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');

  it('returns the now label under a minute', () => {
    expect(formatRelativeWithWeekFallback('2026-09-15T09:59:40.000Z', { now })).toBe('Ahora');
  });

  it('formats minutes, hours and days within a week', () => {
    expect(formatRelativeWithWeekFallback('2026-09-15T09:56:00.000Z', { now })).toBe('hace 4 min');
    expect(formatRelativeWithWeekFallback('2026-09-15T04:00:00.000Z', { now })).toBe('hace 6 h');
    expect(formatRelativeWithWeekFallback('2026-09-11T10:00:00.000Z', { now })).toBe('hace 4 d');
  });

  it('falls back to the absolute date past a week', () => {
    expect(formatRelativeWithWeekFallback('2026-06-01T10:00:00.000Z', { now })).toBe('01/06/2026');
  });
});

describe('formatRelativeCalendar', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');

  it('returns the now label under a minute', () => {
    expect(formatRelativeCalendar('2026-09-15T09:59:40.000Z', { now })).toBe('ahora');
  });

  it('formats minutes and same-calendar-day hours', () => {
    expect(formatRelativeCalendar('2026-09-15T09:56:00.000Z', { now })).toBe('hace 4 min');
    expect(formatRelativeCalendar('2026-09-15T04:00:00.000Z', { now })).toBe('hace 6 h');
  });

  it('says "ayer" for yesterday\'s calendar day even many hours back', () => {
    expect(formatRelativeCalendar('2026-09-14T12:00:00.000Z', { now })).toBe('ayer');
  });

  it('formats days within a week, then falls back to an absolute date', () => {
    expect(formatRelativeCalendar('2026-09-11T15:00:00.000Z', { now })).toBe('hace 4 d');
    expect(formatRelativeCalendar('2026-06-01T10:00:00.000Z', { now })).toBe('01/06/2026');
  });
});

describe('formatRelativeRolling', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');

  it('floors minutes under an hour, at least 1', () => {
    expect(formatRelativeRolling('2026-09-15T09:59:59.000Z', { now })).toBe('hace 1 min');
    expect(formatRelativeRolling('2026-09-15T09:56:00.000Z', { now })).toBe('hace 4 min');
  });

  it('floors hours in a rolling 24h window', () => {
    expect(formatRelativeRolling('2026-09-15T04:00:01.000Z', { now })).toBe('hace 5 h');
  });

  it('says "ayer" in a rolling 24-48h window', () => {
    expect(formatRelativeRolling('2026-09-14T08:00:00.000Z', { now })).toBe('ayer');
  });

  it('falls back to a locale date past 48h', () => {
    expect(formatRelativeRolling('2026-09-01T10:00:00.000Z', { now })).not.toBe('ayer');
  });
});

describe('formatRelativeHoursOnly', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');

  it('floors minutes under an hour, at least 1', () => {
    expect(formatRelativeHoursOnly('2026-09-15T09:59:59.000Z', { now })).toBe('hace 1 min');
  });

  it('floors hours with no day/ayer clause, however far back', () => {
    expect(formatRelativeHoursOnly('2026-09-10T10:00:00.000Z', { now })).toBe('hace 120 h');
  });
});

describe('daysSince / formatRelativeDaysOnly', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');

  it('is 0 for later today, formatted as "hoy"', () => {
    expect(daysSince('2026-09-15T08:00:00.000Z', now)).toBe(0);
    expect(formatRelativeDaysOnly('2026-09-15T08:00:00.000Z', now)).toBe('hoy');
  });

  it('never goes negative for a future timestamp', () => {
    expect(daysSince('2026-09-16T08:00:00.000Z', now)).toBe(0);
  });

  it('floors whole days elapsed', () => {
    expect(daysSince('2026-09-12T09:00:00.000Z', now)).toBe(3);
    expect(formatRelativeDaysOnly('2026-09-12T09:00:00.000Z', now)).toBe('hace 3 d');
  });
});
