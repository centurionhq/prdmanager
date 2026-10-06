import { describe, expect, test } from 'vitest';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { emptyBaseline, type Baseline } from '../../src/sync/baseline.js';
import type { CodeRefState } from '../../src/sync/code-refs.js';
import type { CommitInfo } from '../../src/sync/git.js';
import { acknowledge, detectDrift, type DriftInput } from '../../src/sync/monitor.js';
import { doc, mrd, prd, sdd, wo } from '@prdm/testkit';

const ref = (key: string, hash: string | null): CodeRefState => ({ key, path: key, symbol: null, hash });

/**
 * This suite predates PRD-002's lifecycle rules (WO-019) and its fixtures (`mrd`/`prd`/`sdd`/`wo` from
 * `@prdm/testkit`) intentionally omit `justified_by`/`source_task`/task checklists — none of that is what these
 * tests exercise. Grandfathering every doc under test by its own current hash keeps `checkLifecycle` a no-op
 * here (it never lapses, since the hash always matches what was just passed in) without weakening the rule
 * itself, which has its own dedicated coverage in `lifecycle/check.test.ts`.
 */
function grandfatherAll(docs: readonly ParsedDoc[]): DriftInput['lifecycle'] {
  return { grandfathered: docs.map((d) => ({ id: d.node.id, hash: d.node.contentHash })) };
}

function input(overrides: Partial<DriftInput> & { docs: ParsedDoc[] }): DriftInput {
  return {
    governed: new Map([['SDD-001', [ref('src/sync/a.ts', 'h1')]]]),
    governWarnings: [],
    baseline: emptyBaseline(),
    commits: [],
    dirty: new Set(),
    lifecycle: grandfatherAll(overrides.docs),
    ...overrides,
  };
}

function baselineOf(docs: ParsedDoc[], governs: Baseline['governs'] = { 'SDD-001': { 'src/sync/a.ts': 'h1' } }): Baseline {
  return { version: 1, docs: Object.fromEntries(docs.map((d) => [d.node.id, d.node.contentHash])), governs };
}

const commit = (files: string[], refs: string[]): CommitInfo => ({ sha: 'abc1234', parents: [], author: 'a', date: '2026-09-12T00:00:00Z', subject: 's', refs, files });

describe('detectDrift', () => {
  test('first run records unseen docs and code in the baseline and reports everything synced', () => {
    const docs = [mrd(), prd(), sdd(), wo('WO-001', 'done')];
    const result = detectDrift(input({ docs }));
    expect(result.issues).toEqual([]);
    expect(result.governed).toEqual([{ blueprintId: 'SDD-001', key: 'src/sync/a.ts', path: 'src/sync/a.ts', symbol: null, status: 'synced', reason: 'new' }]);
    expect(result.baseline).toEqual(baselineOf(docs));
    expect(result.workOrderUpdates).toEqual([]);
  });

  test('blueprint change flags done work orders and governed code out of sync', () => {
    const before = [mrd(), prd(), sdd('design v1'), wo('WO-001', 'done'), wo('WO-002', 'pending')];
    const after = [mrd(), prd(), sdd('design v2'), wo('WO-001', 'done'), wo('WO-002', 'pending')];
    const result = detectDrift(input({ docs: after, baseline: baselineOf(before) }));
    expect(result.workOrderUpdates).toEqual([{ id: 'WO-001', sourcePath: 'docs/WO-001.md', from: 'done', to: 'out_of_sync' }]);
    expect(result.governed[0]).toMatchObject({ status: 'out_of_sync', reason: 'blueprint_changed' });
    expect(result.issues.map((i) => [i.kind, i.nodeId])).toEqual([
      ['blueprint_changed', 'SDD-001'],
      ['code_out_of_sync', 'SDD-001'],
      ['work_order_out_of_sync', 'WO-001'],
    ]);
    expect(result.baseline.docs['SDD-001']).toBe(before[2]?.node.contentHash);
  });

  test('code change without a covering commit is out of sync; with a Refs commit of a current done WO it is synced', () => {
    const docs = [mrd(), prd(), sdd(), wo('WO-001', 'done')];
    const baseline = baselineOf(docs, { 'SDD-001': { 'src/sync/a.ts': 'old' } });

    const uncovered = detectDrift(input({ docs, baseline }));
    expect(uncovered.governed[0]).toMatchObject({ status: 'out_of_sync', reason: 'code_changed' });
    expect(uncovered.issues).toMatchObject([{ kind: 'code_out_of_sync', severity: 'error', nodeId: 'SDD-001', target: 'src/sync/a.ts' }]);

    const covered = detectDrift(input({ docs, baseline, commits: [commit(['src/sync/a.ts'], ['WO-001'])] }));
    expect(covered.governed[0]).toMatchObject({ status: 'synced', reason: 'resolved_by_commit' });
    expect(covered.issues).toEqual([]);

    const dirty = detectDrift(input({ docs, baseline, commits: [commit(['src/sync/a.ts'], ['WO-001'])], dirty: new Set(['src/sync/a.ts']) }));
    expect(dirty.governed[0]).toMatchObject({ status: 'out_of_sync' });

    const newerUnrelated = detectDrift(input({ docs, baseline, commits: [commit(['src/sync/a.ts'], []), commit(['src/sync/a.ts'], ['WO-001'])] }));
    expect(newerUnrelated.governed[0]).toMatchObject({ status: 'out_of_sync', reason: 'code_changed' });
  });

  test('a work order completed against the current blueprint stays done and covers its commit', () => {
    const before = [mrd(), prd(), sdd('v1')];
    const current = sdd('v2');
    const done = wo('WO-003', 'done', `blueprint_hashes: {"SDD-001": "${current.node.contentHash}"}`);
    const result = detectDrift(input({ docs: [mrd(), prd(), current, done], baseline: baselineOf(before), commits: [commit(['src/sync/a.ts'], ['WO-003'])] }));
    expect(result.workOrderUpdates).toEqual([]);
    expect(result.governed[0]).toMatchObject({ status: 'synced', reason: 'resolved_by_commit' });
    expect(result.issues.map((i) => i.kind)).toEqual(['blueprint_changed']);
  });

  test('out_of_sync work orders stay flagged until they record current blueprint hashes', () => {
    const blueprint = sdd();
    const stale = [mrd(), prd(), blueprint, wo('WO-001', 'out_of_sync')];
    expect(detectDrift(input({ docs: stale, baseline: baselineOf(stale) })).workOrderUpdates).toEqual([]);

    const recovered = [mrd(), prd(), blueprint, wo('WO-001', 'out_of_sync', `blueprint_hashes: {"SDD-001": "${blueprint.node.contentHash}"}`)];
    const result = detectDrift(input({ docs: recovered, baseline: baselineOf(recovered) }));
    expect(result.workOrderUpdates).toEqual([{ id: 'WO-001', sourcePath: 'docs/WO-001.md', from: 'out_of_sync', to: 'done' }]);
  });

  test('feature change marks architecting blueprints for review and their governed code as legacy', () => {
    const before = [mrd(), prd('v1'), sdd()];
    const after = [mrd(), prd('v2'), sdd()];
    const result = detectDrift(input({ docs: after, baseline: baselineOf(before), commits: [commit(['src/sync/a.ts'], ['WO-001'])] }));
    expect(result.reviewNeeded).toEqual([{ blueprintId: 'SDD-001', featureId: 'PRD-001' }]);
    expect(result.governed[0]).toMatchObject({ status: 'out_of_sync', reason: 'feature_changed' });
    expect(result.issues.map((i) => [i.kind, i.nodeId, i.severity])).toEqual([
      ['feature_changed', 'PRD-001', 'error'],
      ['code_out_of_sync', 'SDD-001', 'error'],
    ]);
    expect(result.baseline.governs['SDD-001']).toEqual({ 'src/sync/a.ts': 'h1' });
  });

  test('acknowledging the evolved feature clears the legacy code flag', () => {
    const before = [mrd(), prd('v1'), sdd()];
    const after = [mrd(), prd('v2'), sdd()];
    const acked = acknowledge(input({ docs: after, baseline: baselineOf(before) }), 'PRD-001');
    expect(detectDrift(input({ docs: after, baseline: acked.baseline })).issues).toEqual([]);
  });

  test('a declared pattern that resolves to no file is an impacts_warning naming it, not code_out_of_sync (WO-692)', () => {
    const docs = [mrd(), prd(), sdd()];
    const result = detectDrift(
      input({ docs, governed: new Map([['SDD-001', [ref('src/sync/gone.ts', null)]]]), governWarnings: [{ blueprintId: 'SDD-001', message: 'no files' }] }),
    );
    expect(result.governed[0]).toMatchObject({ status: 'out_of_sync', reason: 'missing' });
    expect(result.issues.map((i) => [i.kind, i.severity])).toEqual([
      ['impacts_warning', 'warning'],
      ['impacts_warning', 'warning'],
    ]);
    expect(result.issues[0]).toMatchObject({ nodeId: 'SDD-001', target: 'src/sync/gone.ts' });
    expect(result.issues[0]?.message).toContain('src/sync/gone.ts');
    expect(result.issues.some((i) => i.kind === 'code_out_of_sync')).toBe(false);
  });

  test('surfaces a deprecated_field warning for docs still using the legacy governs/todo aliases', () => {
    const legacyBlueprint = doc('id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\ngoverns: ["src/sync/**"]');
    const legacyWorkOrder = doc('id: WO-001\ntype: WO\ntitle: x\nstatus: todo\nimplements: [SDD-001]');
    const docs = [mrd(), prd(), legacyBlueprint, legacyWorkOrder];
    const result = detectDrift(input({ docs, baseline: baselineOf(docs) }));
    expect(result.issues.filter((i) => i.kind === 'deprecated_field').map((i) => i.nodeId)).toEqual(['SDD-001', 'WO-001']);
    expect(result.issues.every((i) => i.kind !== 'deprecated_field' || i.severity === 'warning')).toBe(true);
  });

  test('reports broken links and links to the wrong node type', () => {
    const docs = [
      mrd(),
      doc('id: PRD-002\ntype: PRD\ntitle: X\nimplements: [MRD-404]'),
      doc('id: SDD-002\ntype: SDD\ntitle: Y\narchitects: [MRD-001]'),
      doc('id: WO-009\ntype: WO\ntitle: Z\nimplements: [PRD-002]'),
    ];
    const result = detectDrift(input({ docs, governed: new Map() }));
    expect(result.issues.map((i) => [i.kind, i.nodeId, i.target])).toEqual([
      ['broken_link', 'PRD-002', 'MRD-404'],
      ['invalid_link_target', 'WO-009', 'PRD-002'],
    ]);
  });

  test('prunes deleted docs and blueprints but keeps vanished code refs as missing until resolved', () => {
    const docs = [mrd(), prd(), sdd()];
    const stale: Baseline = {
      version: 1,
      docs: { ...baselineOf(docs).docs, 'WO-999': 'x' },
      governs: { 'SDD-001': { 'src/sync/a.ts': 'h1', 'src/sync/old.ts': 'o' }, 'SDD-404': {} },
    };
    const result = detectDrift(input({ docs, baseline: stale }));
    expect(result.baseline).toEqual(baselineOf(docs, { 'SDD-001': { 'src/sync/a.ts': 'h1', 'src/sync/old.ts': 'o' } }));
    expect(result.governed.find((g) => g.key === 'src/sync/old.ts')).toMatchObject({ status: 'out_of_sync', reason: 'missing' });

    const deletedByWorkOrder = detectDrift(
      input({ docs: [...docs, wo('WO-001', 'done')], baseline: stale, commits: [commit(['src/sync/old.ts'], ['WO-001'])] }),
    );
    expect(deletedByWorkOrder.governed.find((g) => g.key === 'src/sync/old.ts')).toMatchObject({ status: 'synced', reason: 'resolved_by_commit' });
    expect(deletedByWorkOrder.baseline.governs['SDD-001']).toEqual({ 'src/sync/a.ts': 'h1' });
  });

  test('a vanished baseline key stays code_out_of_sync/missing until the ack drops it (WO-692)', () => {
    const docs = [mrd(), prd(), sdd()];
    const stale: Baseline = { ...baselineOf(docs), governs: { 'SDD-001': { 'src/sync/a.ts': 'h1', 'src/sync/old.ts': 'o' } } };
    const result = detectDrift(input({ docs, baseline: stale }));
    expect(result.issues).toMatchObject([{ kind: 'code_out_of_sync', severity: 'error', target: 'src/sync/old.ts' }]);

    const acked = acknowledge(input({ docs, baseline: stale }), 'all');
    expect(acked.discardedKeys).toEqual([{ blueprintId: 'SDD-001', key: 'src/sync/old.ts' }]);
    expect(acked.baseline.governs['SDD-001']).toEqual({ 'src/sync/a.ts': 'h1' });
  });

  test('code resolved by a commit advances the baseline so later unrelated commits do not re-flag it', () => {
    const docs = [mrd(), prd(), sdd(), wo('WO-001', 'done')];
    const baseline = baselineOf(docs, { 'SDD-001': { 'src/sync/a.ts': 'old' } });
    const resolved = detectDrift(input({ docs, baseline, commits: [commit(['src/sync/a.ts'], ['WO-001'])] }));
    expect(resolved.baseline.governs['SDD-001']).toEqual({ 'src/sync/a.ts': 'h1' });

    const later = detectDrift(input({ docs, baseline: resolved.baseline, commits: [commit(['src/sync/a.ts'], []), commit(['src/sync/a.ts'], ['WO-001'])] }));
    expect(later.governed[0]).toMatchObject({ status: 'synced', reason: 'unchanged' });
  });

  test('a commit recorded in resolved_by covers code even without a Refs trailer', () => {
    const docs = [mrd(), prd(), sdd(), wo('WO-001', 'done', 'resolved_by: ["abc1234"]')];
    const baseline = baselineOf(docs, { 'SDD-001': { 'src/sync/a.ts': 'old' } });
    const result = detectDrift(input({ docs, baseline, commits: [commit(['src/sync/a.ts'], [])] }));
    expect(result.governed[0]).toMatchObject({ status: 'synced', reason: 'resolved_by_commit' });
  });

  test('a changed feature without blueprints is still reported', () => {
    const before = [mrd(), prd('v1')];
    const result = detectDrift(input({ docs: [mrd(), prd('v2')], governed: new Map(), baseline: baselineOf(before, {}) }));
    expect(result.reviewNeeded).toEqual([]);
    expect(result.issues.map((i) => [i.kind, i.nodeId])).toEqual([['feature_changed', 'PRD-001']]);
  });
});

describe('X2 shared coverage across blueprints', () => {
  const sdd2 = (body = 'design2', impactsPaths = '["src/sync/**"]'): ParsedDoc =>
    doc(`id: SDD-002\ntype: SDD\ntitle: Design 2\narchitects: [PRD-001]\nimpacts_paths: ${impactsPaths}`, body);
  const woFor = (id: string, blueprintId: string, status: string, extra = ''): ParsedDoc =>
    doc(`id: ${id}\ntype: WO\ntitle: Task ${id}\nstatus: ${status}\nimplements: [${blueprintId}]\n${extra}`, 'task');
  const dualGoverned = new Map([
    ['SDD-001', [ref('src/sync/a.ts', 'h1')]],
    ['SDD-002', [ref('src/sync/a.ts', 'h1')]],
  ]);

  test('a finished, current work order of another blueprint governing the same path covers a code change', () => {
    const docs = [mrd(), prd(), sdd(), sdd2(), woFor('WO-002', 'SDD-002', 'done')];
    const baseline: Baseline = {
      version: 1,
      docs: Object.fromEntries(docs.map((d) => [d.node.id, d.node.contentHash])),
      governs: { 'SDD-001': { 'src/sync/a.ts': 'old' }, 'SDD-002': { 'src/sync/a.ts': 'old' } },
    };
    const result = detectDrift(input({ docs, baseline, governed: dualGoverned, commits: [commit(['src/sync/a.ts'], ['WO-002'])] }));
    expect(result.governed.find((g) => g.blueprintId === 'SDD-001')).toMatchObject({ status: 'synced', reason: 'resolved_by_commit' });
  });

  test('no cross-blueprint coverage when the covering work order is not current for its own blueprint', () => {
    const docs = [mrd(), prd(), sdd(), sdd2('v2'), woFor('WO-002', 'SDD-002', 'done')];
    const baseline: Baseline = {
      version: 1,
      docs: { ...Object.fromEntries(docs.map((d) => [d.node.id, d.node.contentHash])), 'SDD-002': sdd2('v1').node.contentHash },
      governs: { 'SDD-001': { 'src/sync/a.ts': 'old' }, 'SDD-002': { 'src/sync/a.ts': 'old' } },
    };
    const result = detectDrift(input({ docs, baseline, governed: dualGoverned, commits: [commit(['src/sync/a.ts'], ['WO-002'])] }));
    expect(result.governed.find((g) => g.blueprintId === 'SDD-001')).toMatchObject({ status: 'out_of_sync', reason: 'code_changed' });
  });

  test('no cross-blueprint coverage when the path is not governed by the covering work order\'s blueprint', () => {
    const docs = [mrd(), prd(), sdd(), sdd2('design2', '["src/other/**"]'), woFor('WO-002', 'SDD-002', 'done')];
    const baseline: Baseline = {
      version: 1,
      docs: Object.fromEntries(docs.map((d) => [d.node.id, d.node.contentHash])),
      governs: { 'SDD-001': { 'src/sync/a.ts': 'old' }, 'SDD-002': {} },
    };
    const governed = new Map([['SDD-001', [ref('src/sync/a.ts', 'h1')]], ['SDD-002', []]]);
    const result = detectDrift(input({ docs, baseline, governed, commits: [commit(['src/sync/a.ts'], ['WO-002'])] }));
    expect(result.governed.find((g) => g.blueprintId === 'SDD-001')).toMatchObject({ status: 'out_of_sync', reason: 'code_changed' });
  });

  test('cross-blueprint coverage never clears a blueprint design change; a code-only change in the same situation is covered', () => {
    const beforeSdd1 = sdd('design v1');
    const afterSdd1 = sdd('design v2');

    const changedDesign = [mrd(), prd(), afterSdd1, sdd2(), woFor('WO-002', 'SDD-002', 'done')];
    const baselineChangedDesign: Baseline = {
      version: 1,
      docs: { ...Object.fromEntries(changedDesign.map((d) => [d.node.id, d.node.contentHash])), 'SDD-001': beforeSdd1.node.contentHash },
      governs: { 'SDD-001': { 'src/sync/a.ts': 'h1' }, 'SDD-002': { 'src/sync/a.ts': 'h1' } },
    };
    const designChangedResult = detectDrift(
      input({ docs: changedDesign, baseline: baselineChangedDesign, governed: dualGoverned, commits: [commit(['src/sync/a.ts'], ['WO-002'])] }),
    );
    expect(designChangedResult.governed.find((g) => g.blueprintId === 'SDD-001')).toMatchObject({ status: 'out_of_sync', reason: 'blueprint_changed' });

    const codeOnly = [mrd(), prd(), afterSdd1, sdd2(), woFor('WO-002', 'SDD-002', 'done')];
    const baselineCodeOnly: Baseline = {
      version: 1,
      docs: Object.fromEntries(codeOnly.map((d) => [d.node.id, d.node.contentHash])),
      governs: { 'SDD-001': { 'src/sync/a.ts': 'old' }, 'SDD-002': { 'src/sync/a.ts': 'old' } },
    };
    const codeOnlyResult = detectDrift(
      input({ docs: codeOnly, baseline: baselineCodeOnly, governed: dualGoverned, commits: [commit(['src/sync/a.ts'], ['WO-002'])] }),
    );
    expect(codeOnlyResult.governed.find((g) => g.blueprintId === 'SDD-001')).toMatchObject({ status: 'synced', reason: 'resolved_by_commit' });
  });
});

describe('acknowledge', () => {
  const before = [mrd(), prd('v1'), sdd('v1'), wo('WO-001', 'out_of_sync'), wo('WO-002', 'pending')];
  const after = [mrd(), prd('v2'), sdd('v2'), wo('WO-001', 'out_of_sync'), wo('WO-002', 'pending')];
  const stale = { ...baselineOf(before), governs: { 'SDD-001': { 'src/sync/a.ts': 'old' } } };

  test('acknowledging a blueprint re-baselines it and its code but leaves its work orders flagged', () => {
    const result = acknowledge(input({ docs: after, baseline: stale }), 'SDD-001');
    expect(result.baseline.docs['SDD-001']).toBe(after[2]?.node.contentHash);
    expect(result.baseline.docs['PRD-001']).toBe(before[1]?.node.contentHash);
    expect(result.baseline.governs['SDD-001']).toEqual({ 'src/sync/a.ts': 'h1' });
    expect(result.workOrderHashUpdates).toEqual([]);
    expect(stale.governs['SDD-001']).toEqual({ 'src/sync/a.ts': 'old' });
  });

  test('acknowledging a work order marks it current for its blueprints', () => {
    const result = acknowledge(input({ docs: after, baseline: stale }), 'WO-001');
    expect(result.workOrderHashUpdates).toEqual([{ id: 'WO-001', sourcePath: 'docs/WO-001.md', blueprintHashes: { 'SDD-001': after[2]?.node.contentHash } }]);
    expect(result.baseline.docs['SDD-001']).toBe(before[2]?.node.contentHash);
    expect(() => acknowledge(input({ docs: after, baseline: stale }), 'WO-002')).toThrow(/only done or out_of_sync/);
  });

  test('acknowledging a feature only re-baselines that document', () => {
    const result = acknowledge(input({ docs: after, baseline: stale }), 'PRD-001');
    expect(result.baseline.docs['PRD-001']).toBe(after[1]?.node.contentHash);
    expect(result.baseline.docs['SDD-001']).toBe(before[2]?.node.contentHash);
    expect(result.workOrderHashUpdates).toEqual([]);
  });

  test('acknowledging all re-baselines everything and then detectDrift is clean', () => {
    const result = acknowledge(input({ docs: after, baseline: stale }), 'all');
    expect(result.workOrderHashUpdates.map((u) => u.id)).toEqual(['WO-001']);
    const afterAck = after.map((d) => (d.node.id === 'WO-001' ? wo('WO-001', 'done', `blueprint_hashes: {"SDD-001": "${after[2]?.node.contentHash}"}`) : d));
    expect(detectDrift(input({ docs: afterAck, baseline: result.baseline })).issues).toEqual([]);
  });

  test('acknowledging all reports and drops baseline keys the current impacts_paths no longer resolve', () => {
    const docs = [mrd(), prd(), sdd()];
    const baseline: Baseline = { ...baselineOf(docs), governs: { 'SDD-001': { 'src/sync/a.ts': 'h1', 'packages/core/tests': null } } };
    const result = acknowledge(input({ docs, baseline }), 'all');
    expect(result.discardedKeys).toEqual([{ blueprintId: 'SDD-001', key: 'packages/core/tests' }]);
    expect(result.baseline.governs['SDD-001']).toEqual({ 'src/sync/a.ts': 'h1' });
  });

  test('rejects unknown targets', () => {
    expect(() => acknowledge(input({ docs: after, baseline: stale }), 'SDD-404')).toThrow(/unknown/i);
  });
});
