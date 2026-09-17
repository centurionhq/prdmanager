import { describe, expect, test } from 'vitest';
import { assertDraftableKind, assertValidFieldKeys, forbiddenFieldInjectionIssues, forbiddenFieldIssues } from '../../src/authoring/forbidden-fields.js';

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
    const fields = {
      id: 'PRD-001',
      type: 'PRD',
      assigned_to: 'agent:x',
      claimed_at: 'now',
      completed_at: 'now',
      resolved_by: ['abc'],
      blueprint_hashes: {},
      closed_at: 'now',
      closed_by: 'x',
      source_task: 'abc',
      archived_at: 'now',
      archived_by: 'x',
      archive_reason: 'x',
      close_reason: 'x',
      closed_forced: true,
    };
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

describe('assertValidFieldKeys (WO-023 finding 6)', () => {
  test('accepts plain snake_case keys, and undefined', () => {
    expect(() => assertValidFieldKeys(undefined)).not.toThrow();
    expect(() => assertValidFieldKeys({ tags: ['a'], impacts_paths: ['x'], source_task: 'y' })).not.toThrow();
  });

  test('rejects a key that could inject an extra frontmatter line (newline, colon, leading digit, uppercase)', () => {
    expect(() => assertValidFieldKeys({ 'tags: []\nstatus': 'closed' })).toThrow(/invalid field key/);
    expect(() => assertValidFieldKeys({ 'a:b': 'x' })).toThrow(/invalid field key/);
    expect(() => assertValidFieldKeys({ '1abc': 'x' })).toThrow(/invalid field key/);
    expect(() => assertValidFieldKeys({ Status: 'x' })).toThrow(/invalid field key/);
  });
});

describe('forbiddenFieldInjectionIssues (WO-023 finding 6: post-render, post-parse diff)', () => {
  test('flags a create draft that carries a forbidden field into the rendered frontmatter', () => {
    const issues = forbiddenFieldInjectionIssues({ assigned_to: 'agent:x' }, undefined);
    expect(issues).toEqual([expect.objectContaining({ code: 'forbidden_field', field: 'assigned_to' })]);
  });

  test('does not flag a value carried over unchanged from the base document (update mode)', () => {
    const base = { assigned_to: 'agent:x', status: 'in_progress' };
    expect(forbiddenFieldInjectionIssues({ ...base }, base)).toEqual([]);
  });

  test('flags a forbidden field whose value changed relative to the base document', () => {
    const base = { assigned_to: 'agent:x' };
    const issues = forbiddenFieldInjectionIssues({ assigned_to: 'agent:y' }, base);
    expect(issues).toEqual([expect.objectContaining({ code: 'forbidden_field', field: 'assigned_to' })]);
  });

  test('never flags id/type: they are always freshly assigned, not "changed" by the draft', () => {
    expect(forbiddenFieldInjectionIssues({ id: 'FB-000000000', type: 'FB' }, undefined)).toEqual([]);
  });

  test('flags status moving to a terminal value even without an explicit base', () => {
    expect(forbiddenFieldInjectionIssues({ status: 'closed' }, undefined)).toEqual([expect.objectContaining({ code: 'forbidden_field', field: 'status' })]);
  });

  test('does not flag a terminal status that was already the base value (unchanged)', () => {
    expect(forbiddenFieldInjectionIssues({ status: 'done' }, { status: 'done' })).toEqual([]);
  });
});
