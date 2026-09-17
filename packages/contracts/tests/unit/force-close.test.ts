import { describe, expect, test } from 'vitest';
import { forceCloseFeatureInputSchema } from '../../src/force-close.js';

describe('forceCloseFeatureInputSchema (WO-419/SDD-018)', () => {
  test('accepts a reason and at least one bypassable check', () => {
    expect(forceCloseFeatureInputSchema.parse({ reason: 'known issue, closing anyway', bypass: ['project_clean'] })).toEqual({
      reason: 'known issue, closing anyway',
      bypass: ['project_clean'],
    });
  });

  test('rejects a missing reason', () => {
    expect(() => forceCloseFeatureInputSchema.parse({ bypass: ['project_clean'] })).toThrow();
  });

  test('rejects an empty-string reason', () => {
    expect(() => forceCloseFeatureInputSchema.parse({ reason: '', bypass: ['project_clean'] })).toThrow();
  });

  test('rejects a whitespace-only reason at the contract layer (not just forceCloseFeature\'s own runtime check)', () => {
    expect(() => forceCloseFeatureInputSchema.parse({ reason: '   ', bypass: ['project_clean'] })).toThrow();
  });

  test('trims a reason with leading/trailing whitespace', () => {
    expect(forceCloseFeatureInputSchema.parse({ reason: '  known issue  ', bypass: ['project_clean'] }).reason).toBe('known issue');
  });

  test('rejects an empty bypass array', () => {
    expect(() => forceCloseFeatureInputSchema.parse({ reason: 'x', bypass: [] })).toThrow();
  });

  test('rejects a check name outside the three bypassable ones', () => {
    expect(() => forceCloseFeatureInputSchema.parse({ reason: 'x', bypass: ['feature_approved'] })).toThrow();
    expect(() => forceCloseFeatureInputSchema.parse({ reason: 'x', bypass: ['feature_exists'] })).toThrow();
  });
});
