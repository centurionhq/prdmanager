import { describe, expect, test } from 'vitest';
import { DOC_KINDS, ID_PATTERN, LABEL_BY_KIND, businessCaseSchema, frontmatterSchema } from '../../src/domain/schema.js';

/** PRD-011 §4.1/SDD-022 "El Caso de Negocio como kind de primera clase": BC reuses the `Feature` label
 * (never a new `NodeLabel`) and its own schema, not a `featureSchema` variant -- see `businessCaseSchema`'s
 * doc comment for why. */
describe('BC kind (WO-433)', () => {
  test('DOC_KINDS includes BC', () => {
    expect(DOC_KINDS).toContain('BC');
  });

  test('LABEL_BY_KIND.BC is Feature, not a new label', () => {
    expect(LABEL_BY_KIND.BC).toBe('Feature');
  });

  test('ID_PATTERN accepts BC-001 and rejects an unknown prefix', () => {
    expect(ID_PATTERN.test('BC-001')).toBe(true);
    expect(ID_PATTERN.test('XYZ-001')).toBe(false);
  });

  const base = { id: 'BC-001', type: 'BC' as const, title: 'Reducir el churn de cuentas nuevas' };

  test('businessCaseSchema parses a minimal valid BC', () => {
    const result = businessCaseSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('BC');
      expect(result.data.tags).toEqual([]);
    }
  });

  test('businessCaseSchema rejects a document with type !== "BC"', () => {
    const result = businessCaseSchema.safeParse({ ...base, type: 'PRD' });
    expect(result.success).toBe(false);
  });

  test('businessCaseSchema accepts justified_by, same shape as featureSchema', () => {
    const result = businessCaseSchema.safeParse({ ...base, justified_by: ['FB-001'] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.justified_by).toEqual(['FB-001']);
  });

  test('businessCaseSchema has no impacts_paths/architects: it is not a blueprint', () => {
    const result = businessCaseSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('impacts_paths' in result.data).toBe(false);
      expect('architects' in result.data).toBe(false);
    }
  });

  test('closed_at/closed_by/close_reason/closed_forced mirror featureSchema (BC is closeFeature-eligible: same label)', () => {
    const result = businessCaseSchema.safeParse({
      ...base,
      status: 'closed',
      closed_at: '2026-09-18T00:00:00.000Z',
      closed_by: 'dev:tano',
      close_reason: 'known drift, closing anyway',
      closed_forced: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.closed_by).toBe('dev:tano');
      expect(result.data.closed_forced).toBe(true);
    }
  });

  test('frontmatterSchema (the discriminated union) dispatches type: "BC" to businessCaseSchema', () => {
    const result = frontmatterSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('BC');
  });
});
