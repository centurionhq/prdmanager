import { describe, expect, test } from 'vitest';
import { assertDraftableKind, forbiddenFieldIssues } from '../../src/authoring/forbidden-fields.js';

describe('assertDraftableKind', () => {
  test('rejects WO', () => {
    expect(() => assertDraftableKind('WO')).toThrow(/work orders cannot be drafted/);
  });
  test('accepts every other kind', () => {
    for (const kind of ['MRD', 'PRD', 'FR', 'SDD', 'ADR', 'ART', 'FB']) expect(() => assertDraftableKind(kind)).not.toThrow();
  });
});

describe('forbiddenFieldIssues', () => {
  test('returns no issues for undefined or empty fields', () => {
    expect(forbiddenFieldIssues(undefined)).toEqual([]);
    expect(forbiddenFieldIssues({})).toEqual([]);
  });

  test('flags identity, lifecycle and provenance fields', () => {
    const fields = { id: 'PRD-001', type: 'PRD', assigned_to: 'agent:x', claimed_at: 'now', completed_at: 'now', resolved_by: ['abc'], blueprint_hashes: {}, closed_at: 'now', closed_by: 'x', source_task: 'abc' };
    const issues = forbiddenFieldIssues(fields as never);
    expect(issues).toHaveLength(Object.keys(fields).length);
    expect(issues.every((i) => i.code === 'forbidden_field' && i.severity === 'error')).toBe(true);
  });

  test('flags status only when set to a terminal/lifecycle-managed value', () => {
    expect(forbiddenFieldIssues({ status: 'closed' })).toHaveLength(1);
    expect(forbiddenFieldIssues({ status: 'done' })).toHaveLength(1);
    expect(forbiddenFieldIssues({ status: 'out_of_sync' })).toHaveLength(1);
    expect(forbiddenFieldIssues({ status: 'draft' })).toEqual([]);
    expect(forbiddenFieldIssues({ status: 'approved' })).toEqual([]);
  });

  test('does not flag ordinary content fields', () => {
    expect(forbiddenFieldIssues({ tags: ['a', 'b'], implements: ['PRD-001'] })).toEqual([]);
  });
});
