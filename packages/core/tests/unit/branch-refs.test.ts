import { describe, expect, test } from 'vitest';
import { evaluateBranchRefs, parseBranchRef } from '../../src/sync/branch-refs.js';

describe('parseBranchRef', () => {
  test.each([
    ['fix/wo-447-seed-journal', { kind: 'WO', id: 'WO-447' }],
    ['feat/sdd-039-x', { kind: 'SDD', id: 'SDD-039' }],
    ['feat/prd-013-x', { kind: 'PRD', id: 'PRD-013' }],
    ['main', null],
    ['chore/no-ref-here', null],
  ])('parses %s', (branch, expected) => {
    expect(parseBranchRef(branch)).toEqual(expected);
  });
});

describe('evaluateBranchRefs', () => {
  test('reports a commit whose Refs name a different WO', () => {
    const result = evaluateBranchRefs('feat/wo-001-x', [{ sha: 'abc', refs: ['WO-002'] }]);
    expect(result.expected).toBe('WO-001');
    expect(result.mismatches).toEqual([{ sha: 'abc', refs: ['WO-002'], expected: 'WO-001' }]);
  });

  test('reports a commit without refs with an empty refs list', () => {
    const result = evaluateBranchRefs('feat/wo-001-x', [{ sha: 'abc', refs: [] }]);
    expect(result.mismatches).toEqual([{ sha: 'abc', refs: [], expected: 'WO-001' }]);
  });

  test('has no mismatches when the commit references the expected WO', () => {
    const result = evaluateBranchRefs('feat/wo-001-x', [{ sha: 'abc', refs: ['WO-001'] }]);
    expect(result.mismatches).toEqual([]);
  });

  test('does not check branches that declare a non-WO document', () => {
    const result = evaluateBranchRefs('feat/sdd-002-x', [{ sha: 'abc', refs: ['WO-001'] }]);
    expect(result.expected).toBeNull();
    expect(result.mismatches).toEqual([]);
  });

  test('has no mismatches when there is no branch', () => {
    const result = evaluateBranchRefs(null, [{ sha: 'abc', refs: ['WO-001'] }]);
    expect(result.mismatches).toEqual([]);
  });
});
