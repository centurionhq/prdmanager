import { describe, expect, test } from 'vitest';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { emptyBaseline, type Baseline } from '../../src/sync/baseline.js';
import type { CodeRefState } from '../../src/sync/code-refs.js';
import type { CommitInfo } from '../../src/sync/git.js';
import { acknowledge, detectDrift, type DriftInput } from '../../src/sync/monitor.js';
import { doc, mrd, prd, sdd, wo } from '../helpers/docs.js';

const ref = (key: string, hash: string | null): CodeRefState => ({ key, path: key, symbol: null, hash });

function input(overrides: Partial<DriftInput> & { docs: ParsedDoc[] }): DriftInput {
  return {
    governed: new Map([['SDD-001', [ref('src/sync/a.ts', 'h1')]]]),
    governWarnings: [],
    baseline: emptyBaseline(),
    commits: [],
    dirty: new Set(),
    ...overrides,
  };
}

function baselineOf(docs: ParsedDoc[], governs: Baseline['governs'] = { 'SDD-001': { 'src/sync/a.ts': 'h1' } }): Baseline {
  return { version: 1, docs: Object.fromEntries(docs.map((d) => [d.node.id, d.node.contentHash])), governs };
}

const commit = (files: string[], refs: string[]): CommitInfo => ({ sha: 'abc1234', author: 'a', date: '2026-09-12T00:00:00Z', subject: 's', refs, files });

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
    const before = [mrd(), prd(), sdd('design v1'), wo('WO-001', 'done'), wo('WO-002', 'todo')];
    const after = [mrd(), prd(), sdd('design v2'), wo('WO-001', 'done'), wo('WO-002', 'todo')];
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

  test('out_of_sync work orders return to done once the blueprint is back in sync', () => {
    const docs = [mrd(), prd(), sdd(), wo('WO-001', 'out_of_sync')];
    const result = detectDrift(input({ docs, baseline: baselineOf(docs) }));
    expect(result.workOrderUpdates).toEqual([{ id: 'WO-001', sourcePath: 'docs/WO-001.md', from: 'out_of_sync', to: 'done' }]);
  });

  test('feature change marks architecting blueprints for review', () => {
    const before = [mrd(), prd('v1'), sdd()];
    const after = [mrd(), prd('v2'), sdd()];
    const result = detectDrift(input({ docs: after, baseline: baselineOf(before) }));
    expect(result.reviewNeeded).toEqual([{ blueprintId: 'SDD-001', featureId: 'PRD-001' }]);
    expect(result.issues.map((i) => [i.kind, i.nodeId, i.severity])).toEqual([['feature_changed', 'PRD-001', 'error']]);
  });

  test('missing governed code is out of sync and governs warnings are surfaced', () => {
    const docs = [mrd(), prd(), sdd()];
    const result = detectDrift(
      input({ docs, governed: new Map([['SDD-001', [ref('src/sync/gone.ts', null)]]]), governWarnings: [{ blueprintId: 'SDD-001', message: 'no files' }] }),
    );
    expect(result.governed[0]).toMatchObject({ status: 'out_of_sync', reason: 'missing' });
    expect(result.issues.map((i) => [i.kind, i.severity])).toEqual([
      ['code_out_of_sync', 'error'],
      ['governs_warning', 'warning'],
    ]);
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

  test('prunes baseline entries for deleted docs and code refs', () => {
    const docs = [mrd(), prd(), sdd()];
    const stale: Baseline = { version: 1, docs: { ...baselineOf(docs).docs, 'WO-999': 'x' }, governs: { 'SDD-001': { 'src/sync/a.ts': 'h1', 'src/sync/old.ts': 'o' }, 'SDD-404': {} } };
    const result = detectDrift(input({ docs, baseline: stale }));
    expect(result.baseline).toEqual(baselineOf(docs));
  });
});

describe('acknowledge', () => {
  const before = [mrd(), prd('v1'), sdd('v1'), wo('WO-001', 'out_of_sync'), wo('WO-002', 'todo')];
  const after = [mrd(), prd('v2'), sdd('v2'), wo('WO-001', 'out_of_sync'), wo('WO-002', 'todo')];
  const stale = { ...baselineOf(before), governs: { 'SDD-001': { 'src/sync/a.ts': 'old' } } };

  test('acknowledging a blueprint re-baselines it, its code and its finished work orders', () => {
    const result = acknowledge(input({ docs: after, baseline: stale }), 'SDD-001');
    expect(result.baseline.docs['SDD-001']).toBe(after[2]?.node.contentHash);
    expect(result.baseline.docs['PRD-001']).toBe(before[1]?.node.contentHash);
    expect(result.baseline.governs['SDD-001']).toEqual({ 'src/sync/a.ts': 'h1' });
    expect(result.workOrderHashUpdates).toEqual([{ id: 'WO-001', sourcePath: 'docs/WO-001.md', blueprintHashes: { 'SDD-001': after[2]?.node.contentHash } }]);
    expect(stale.governs['SDD-001']).toEqual({ 'src/sync/a.ts': 'old' });
  });

  test('acknowledging a feature only re-baselines that document', () => {
    const result = acknowledge(input({ docs: after, baseline: stale }), 'PRD-001');
    expect(result.baseline.docs['PRD-001']).toBe(after[1]?.node.contentHash);
    expect(result.baseline.docs['SDD-001']).toBe(before[2]?.node.contentHash);
    expect(result.workOrderHashUpdates).toEqual([]);
  });

  test('acknowledging all re-baselines everything and then detectDrift is clean', () => {
    const result = acknowledge(input({ docs: after, baseline: stale }), 'all');
    const afterAck = after.map((d) => (d.node.id === 'WO-001' ? wo('WO-001', 'done', `blueprint_hashes: {"SDD-001": "${after[2]?.node.contentHash}"}`) : d));
    expect(detectDrift(input({ docs: afterAck, baseline: result.baseline })).issues).toEqual([]);
  });

  test('rejects unknown targets', () => {
    expect(() => acknowledge(input({ docs: after, baseline: stale }), 'SDD-404')).toThrow(/unknown/i);
  });
});
