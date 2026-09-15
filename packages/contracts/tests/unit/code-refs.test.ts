/**
 * `project_code_refs` row DTO validation (SDD-012, WO-326/WO-331): the persisted per-ref governance
 * state `PgProjectEngine.buildDriftInput` (WO-334) reads back, plus its sync verdict.
 */
import { describe, expect, test } from 'vitest';
import { codeRefDtoSchema, codeRefSyncVerdictSchema } from '../../src/code-refs.js';

describe('codeRefDtoSchema', () => {
  const valid = {
    projectId: 'proj-1',
    orgId: 'org-1',
    blueprintId: 'SDD-001',
    refKey: 'src/sync/monitor.ts#detect',
    path: 'src/sync/monitor.ts',
    symbol: 'detect',
    hash: 'a'.repeat(64),
    hashAlgoVersion: 1,
    reportId: 'report-1',
    headSha: 'a'.repeat(40),
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  test('accepts a full row', () => {
    expect(codeRefDtoSchema.parse(valid)).toEqual(valid);
  });

  test('accepts a null symbol and hash', () => {
    const parsed = codeRefDtoSchema.parse({ ...valid, symbol: null, hash: null });
    expect(parsed.symbol).toBeNull();
    expect(parsed.hash).toBeNull();
  });

  test('rejects a non-positive hashAlgoVersion', () => {
    expect(() => codeRefDtoSchema.parse({ ...valid, hashAlgoVersion: 0 })).toThrow();
  });
});

describe('codeRefSyncVerdictSchema', () => {
  test('accepts synced with no reason required beyond the enum', () => {
    expect(codeRefSyncVerdictSchema.parse({ status: 'synced', reason: 'unchanged' })).toEqual({ status: 'synced', reason: 'unchanged' });
  });

  test('accepts out_of_sync with a code_changed reason', () => {
    expect(codeRefSyncVerdictSchema.parse({ status: 'out_of_sync', reason: 'code_changed' })).toEqual({ status: 'out_of_sync', reason: 'code_changed' });
  });

  test('rejects an invalid status', () => {
    expect(() => codeRefSyncVerdictSchema.parse({ status: 'pending', reason: 'unchanged' })).toThrow();
  });

  test('rejects an invalid reason', () => {
    expect(() => codeRefSyncVerdictSchema.parse({ status: 'synced', reason: 'bogus' })).toThrow();
  });
});
