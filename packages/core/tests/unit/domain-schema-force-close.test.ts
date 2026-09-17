import { describe, expect, test } from 'vitest';
import { featureSchema } from '../../src/domain/schema.js';

/** SDD-018 "Cierre forzado auditado": close_reason/closed_forced mirror the closed_at/closed_by
 * hash-neutral pattern on featureSchema exactly (optional, no default). Written by forceCloseFeature
 * (WO-417), never by an author (see FORBIDDEN_STATIC_FIELDS). */
describe('featureSchema close_reason/closed_forced fields (WO-418)', () => {
  const base = { id: 'PRD-001', type: 'PRD' as const, title: 'Feature' };

  test('accepts status: closed with close_reason and closed_forced', () => {
    const result = featureSchema.safeParse({ ...base, status: 'closed', close_reason: 'known issue, closing anyway', closed_forced: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.close_reason).toBe('known issue, closing anyway');
      expect(result.data.closed_forced).toBe(true);
    }
  });

  test('close_reason/closed_forced are optional with no default (hash-neutral, mirrors closed_at/closed_by)', () => {
    const result = featureSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('close_reason' in result.data).toBe(false);
      expect('closed_forced' in result.data).toBe(false);
    }
  });

  test('closed_forced must be a boolean when present', () => {
    const result = featureSchema.safeParse({ ...base, closed_forced: 'yes' });
    expect(result.success).toBe(false);
  });
});
