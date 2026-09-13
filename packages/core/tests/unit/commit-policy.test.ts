import { describe, expect, test } from 'vitest';
import { evaluateCommit, type EvaluateCommitInput, type PolicyDoc } from '../../src/sync/commit-policy.js';

const SDD_001: PolicyDoc = { type: 'SDD', id: 'SDD-001', impactsPaths: ['src/sync/**'] };
const SDD_002: PolicyDoc = { type: 'SDD', id: 'SDD-002', impactsPaths: ['src/other/**'] };
const WO_OPEN: PolicyDoc = { type: 'WO', id: 'WO-001', status: 'pending', implements: ['SDD-001'] };
const WO_DONE: PolicyDoc = { type: 'WO', id: 'WO-002', status: 'done', implements: ['SDD-001'] };
const WO_OTHER_BLUEPRINT: PolicyDoc = { type: 'WO', id: 'WO-003', status: 'pending', implements: ['SDD-002'] };

function baseInput(overrides: Partial<EvaluateCommitInput> = {}): EvaluateCommitInput {
  return {
    changedPaths: ['src/sync/monitor.ts'],
    message: 'feat: change monitor',
    isMerge: false,
    hasConflictsInGoverned: false,
    docsAtHead: [SDD_001, WO_OPEN],
    docsInIndex: [SDD_001, WO_OPEN],
    settings: { enforceRefs: true, isWithinEnforcementRange: true },
    ...overrides,
  };
}

describe('evaluateCommit', () => {
  test('no governed change is always ok', () => {
    const result = evaluateCommit(baseInput({ changedPaths: ['README.md'] }));
    expect(result).toEqual({ ok: true, requiredFor: [], refs: [] });
  });

  test('a governed change without a Refs trailer is rejected', () => {
    const result = evaluateCommit(baseInput({ message: 'feat: change monitor' }));
    expect(result.ok).toBe(false);
    expect(result.requiredFor).toEqual(['src/sync/monitor.ts']);
    expect(result.message).toContain('src/sync/monitor.ts');
    expect(result.message).toContain('WO-001');
  });

  test('an unknown WO id is rejected', () => {
    const result = evaluateCommit(baseInput({ message: 'feat: x\n\nRefs: WO-999' }));
    expect(result.ok).toBe(false);
    expect(result.refs).toEqual(['WO-999']);
  });

  test('a done WO is rejected: only pending/in_progress/out_of_sync satisfy the policy', () => {
    const result = evaluateCommit(baseInput({ docsAtHead: [SDD_001, WO_DONE], docsInIndex: [SDD_001, WO_DONE], message: 'feat: x\n\nRefs: WO-002' }));
    expect(result.ok).toBe(false);
  });

  test('out_of_sync is accepted as an open status', () => {
    const woOutOfSync: PolicyDoc = { type: 'WO', id: 'WO-004', status: 'out_of_sync', implements: ['SDD-001'] };
    const result = evaluateCommit(baseInput({ docsAtHead: [SDD_001, woOutOfSync], docsInIndex: [SDD_001, woOutOfSync], message: 'fix: x\n\nRefs: WO-004' }));
    expect(result.ok).toBe(true);
  });

  test('a WO whose blueprint does not govern the touched path is rejected', () => {
    const result = evaluateCommit(
      baseInput({ docsAtHead: [SDD_001, SDD_002, WO_OTHER_BLUEPRINT], docsInIndex: [SDD_001, SDD_002, WO_OTHER_BLUEPRINT], message: 'feat: x\n\nRefs: WO-003' }),
    );
    expect(result.ok).toBe(false);
  });

  test('an open WO whose blueprint governs the touched path is accepted', () => {
    const result = evaluateCommit(baseInput({ message: 'feat: x\n\nRefs: WO-001' }));
    expect(result.ok).toBe(true);
    expect(result.refs).toEqual(['WO-001']);
  });

  test('union of HEAD and index prevents shrinking governed coverage', () => {
    // The blueprint's impacts_paths was narrowed in the index (no longer governs src/sync/**), but HEAD still governs it.
    const shrunk: PolicyDoc = { type: 'SDD', id: 'SDD-001', impactsPaths: ['src/nowhere/**'] };
    const result = evaluateCommit(baseInput({ docsAtHead: [SDD_001, WO_OPEN], docsInIndex: [shrunk, WO_OPEN], message: 'feat: sneaky change' }));
    expect(result.ok).toBe(false);
    expect(result.requiredFor).toEqual(['src/sync/monitor.ts']);
  });

  test('enforceRefs: false always passes, even without a Refs trailer', () => {
    const result = evaluateCommit(baseInput({ settings: { enforceRefs: false, isWithinEnforcementRange: true } }));
    expect(result.ok).toBe(true);
  });

  test('a commit outside the enforcement range (enforce_refs_since) is exempt', () => {
    const result = evaluateCommit(baseInput({ settings: { enforceRefs: true, isWithinEnforcementRange: false } }));
    expect(result.ok).toBe(true);
  });

  test('a merge without conflicts in governed code is exempt', () => {
    const result = evaluateCommit(baseInput({ isMerge: true, hasConflictsInGoverned: false, message: 'Merge branch x' }));
    expect(result.ok).toBe(true);
  });

  test('a merge with conflicts resolved in governed code still requires Refs', () => {
    const result = evaluateCommit(baseInput({ isMerge: true, hasConflictsInGoverned: true, message: 'Merge branch x' }));
    expect(result.ok).toBe(false);
  });

  test('a valid ref among several candidates is enough', () => {
    const result = evaluateCommit(baseInput({ message: 'feat: x\n\nRefs: WO-999, WO-001' }));
    expect(result.ok).toBe(true);
  });

  test('#symbol suffixes in impacts_paths are stripped before matching', () => {
    const symbolBlueprint: PolicyDoc = { type: 'SDD', id: 'SDD-005', impactsPaths: ['src/sync/git.ts#parseRefs'] };
    const wo: PolicyDoc = { type: 'WO', id: 'WO-010', status: 'pending', implements: ['SDD-005'] };
    const result = evaluateCommit(
      baseInput({ changedPaths: ['src/sync/git.ts'], docsAtHead: [symbolBlueprint, wo], docsInIndex: [symbolBlueprint, wo], message: 'feat: x' }),
    );
    expect(result.ok).toBe(false);
    expect(result.requiredFor).toEqual(['src/sync/git.ts']);
  });
});
