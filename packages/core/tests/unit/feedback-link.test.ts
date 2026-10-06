import { describe, expect, test } from 'vitest';
import { doc } from '@prdm/testkit';
import type { ParsedDoc } from '../../src/domain/schema.js';
import type { EngineOps, ProjectEngine, ProjectSettings, RecoverResult, RefreshReport } from '../../src/engine.js';
import type { FieldValue } from '../../src/parser/frontmatter-edit.js';
import type { ScanResult } from '../../src/parser/scan.js';
import type { GraphStore } from '../../src/graph/types.js';
import { closeFeedback, dismissFeedback, linkFeedback, markDuplicate, triageFeedback, triageFeedbackBatch } from '../../src/feedback/link.js';

const prd = (): ParsedDoc => doc('id: PRD-001\ntype: PRD\ntitle: Product');
const fb = (status = 'new'): ParsedDoc => doc(`id: FB-001\ntype: FB\ntitle: Feedback\nstatus: ${status}`);

function applyFields(target: ParsedDoc, fields: Record<string, FieldValue>): ParsedDoc {
  if (target.frontmatter.type !== 'FB') throw new Error('fake engine only supports FB updates in this test');
  const frontmatter = { ...target.frontmatter, ...fields } as typeof target.frontmatter;
  const status = typeof fields.status === 'string' ? fields.status : target.node.status;
  return { ...target, frontmatter, node: { ...target.node, status } };
}

const EMPTY_REPORT: RefreshReport = { documents: 0, errors: [], issues: [], governed: [], workOrderUpdates: [], baselineWritten: false, hasBlockingIssues: false };

/**
 * A minimal `ProjectEngine` test double: `updateDocument` either applies fields to the target doc
 * immediately (the default) or, for any id in `deferredIds`, returns the target unchanged — simulating
 * `PgProjectEngine.writeGeneratedFields`'s `queuePendingEditablePatch` branch for a `collab`-origin
 * document with a working copy (WO-330's "deferred" case), without needing a real Postgres-backed
 * engine to exercise `triageFeedback`'s own origin-agnostic detection logic.
 */
class FakeEngine implements ProjectEngine {
  readonly settings = {} as ProjectSettings;
  readonly store = {} as GraphStore;
  docs: ParsedDoc[];
  private readonly deferredIds: Set<string>;

  constructor(docs: ParsedDoc[], deferredIds: Set<string> = new Set()) {
    this.docs = docs;
    this.deferredIds = deferredIds;
  }

  async transaction<T>(fn: (ops: EngineOps) => Promise<T>): Promise<T> {
    return fn(this.buildOps());
  }
  refresh(): Promise<RefreshReport> {
    return Promise.resolve(EMPTY_REPORT);
  }
  inspect(): Promise<RefreshReport> {
    return Promise.resolve(EMPTY_REPORT);
  }
  lastReport(): Promise<RefreshReport | null> {
    return Promise.resolve(null);
  }
  acknowledge(): Promise<RefreshReport> {
    return Promise.resolve(EMPTY_REPORT);
  }
  recover(): Promise<RecoverResult> {
    return Promise.resolve({ recovered: false, warnings: [] });
  }
  scan(): Promise<ScanResult> {
    return Promise.resolve({ docs: this.docs, errors: [], ids: this.docs.map((d) => d.node.id) });
  }

  private buildOps(): EngineOps {
    return {
      config: {} as EngineOps['config'],
      store: this.store,
      scan: () => this.scan(),
      createDocument: () => Promise.reject(new Error('not implemented')),
      updateDocument: (id, fields) => this.updateDocument(id, fields),
      renameFrontmatterField: () => Promise.reject(new Error('not implemented')),
      replaceDocument: () => Promise.reject(new Error('not implemented')),
      refresh: () => this.refresh(),
      inspect: () => this.inspect(),
      readCommit: () => Promise.resolve(null),
    };
  }

  private async updateDocument(id: string, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    const target = this.docs.find((d) => d.node.id === id);
    if (!target) throw new Error(`document ${id} not found`);
    if (this.deferredIds.has(id)) return target;
    const updated = applyFields(target, fields);
    this.docs = this.docs.map((d) => (d.node.id === id ? updated : d));
    return updated;
  }
}

describe('triageFeedback', () => {
  test('requires informs or root', async () => {
    const engine = new FakeEngine([fb(), prd()]);
    await expect(triageFeedback(engine, 'FB-001', {})).rejects.toThrow(/informs.*root/);
  });

  test('rejects a feedback id that does not exist', async () => {
    const engine = new FakeEngine([prd()]);
    await expect(triageFeedback(engine, 'FB-404', { root: true })).rejects.toThrow(/not found/);
  });

  test('rejects an informs target that is not a Feature', async () => {
    const engine = new FakeEngine([fb(), doc('id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-999]')]);
    await expect(triageFeedback(engine, 'FB-001', { informs: ['SDD-001'] })).rejects.toThrow(/must be a Feature/);
  });

  test('rejects feedback that is no longer new', async () => {
    const engine = new FakeEngine([fb('triaged'), prd()]);
    await expect(triageFeedback(engine, 'FB-001', { informs: ['PRD-001'] })).rejects.toThrow(/only new feedback can be triaged/);
  });

  test('an immediately-applied update (generated origin / local Engine) reports applied: immediate', async () => {
    const engine = new FakeEngine([fb(), prd()]);
    const result = await triageFeedback(engine, 'FB-001', { informs: ['PRD-001'] });
    expect(result).toEqual({ id: 'FB-001', linkedTo: ['PRD-001'], root: false, applied: 'immediate' });
  });

  test('a deferred update (collab origin with a working copy) reports applied: deferred, with the intended link', async () => {
    const engine = new FakeEngine([fb(), prd()], new Set(['FB-001']));
    const result = await triageFeedback(engine, 'FB-001', { informs: ['PRD-001'] });
    expect(result).toEqual({ id: 'FB-001', linkedTo: ['PRD-001'], root: false, applied: 'deferred' });
  });

  test('root: true satisfies the requirement without any informs', async () => {
    const engine = new FakeEngine([fb()]);
    const result = await triageFeedback(engine, 'FB-001', { root: true });
    expect(result).toEqual({ id: 'FB-001', linkedTo: [], root: true, applied: 'immediate' });
  });

  test('merges new informs with whatever the feedback already had', async () => {
    const engine = new FakeEngine([fb(), prd(), doc('id: PRD-002\ntype: PRD\ntitle: Second', 'body', 'docs/PRD-002.md')]);
    engine.docs = engine.docs.map((d) => (d.node.id === 'FB-001' ? applyFields(d, { informs: ['PRD-002'] }) : d));
    const result = await triageFeedback(engine, 'FB-001', { informs: ['PRD-001'] });
    expect(result.linkedTo.sort()).toEqual(['PRD-001', 'PRD-002']);
  });
});

const fb2 = (): ParsedDoc => doc('id: FB-002\ntype: FB\ntitle: Other\nstatus: new', 'body', 'docs/FB-002.md');
const statusOf = (engine: FakeEngine, id: string): Record<string, unknown> => engine.docs.find((d) => d.node.id === id)!.frontmatter as Record<string, unknown>;

describe('dismissFeedback', () => {
  test('dismisses a new feedback and records the reason', async () => {
    const engine = new FakeEngine([fb()]);
    const result = await dismissFeedback(engine, 'FB-001', { reason: 'ruido' });
    expect(result).toEqual({ id: 'FB-001', status: 'dismissed', reason: 'ruido', applied: 'immediate' });
    expect(statusOf(engine, 'FB-001')).toMatchObject({ status: 'dismissed', dismiss_reason: 'ruido' });
  });

  test('reports applied: deferred for a collab-origin document', async () => {
    const engine = new FakeEngine([fb()], new Set(['FB-001']));
    const result = await dismissFeedback(engine, 'FB-001', { reason: 'ruido' });
    expect(result.applied).toBe('deferred');
  });

  test('dismisses a triaged feedback', async () => {
    const engine = new FakeEngine([fb('triaged')]);
    await dismissFeedback(engine, 'FB-001');
    expect(statusOf(engine, 'FB-001')).toMatchObject({ status: 'dismissed' });
  });

  test.each(['closed', 'dismissed', 'duplicate'])('rejects a %s feedback', async (status) => {
    await expect(dismissFeedback(new FakeEngine([fb(status)]), 'FB-001')).rejects.toThrow(/only new or triaged feedback can be dismissed/);
  });

  test('rejects a missing or non-feedback target', async () => {
    await expect(dismissFeedback(new FakeEngine([prd()]), 'FB-404')).rejects.toThrow(/not found/);
    await expect(dismissFeedback(new FakeEngine([prd()]), 'PRD-001')).rejects.toThrow(/is not Feedback/);
  });

  test('without a reason it returns reason: null and writes no dismiss_reason', async () => {
    const engine = new FakeEngine([fb()]);
    const result = await dismissFeedback(engine, 'FB-001');
    expect(result.reason).toBeNull();
    expect(statusOf(engine, 'FB-001')).not.toHaveProperty('dismiss_reason');
  });
});

describe('markDuplicate', () => {
  test('marks a new feedback as a duplicate of another feedback', async () => {
    const engine = new FakeEngine([fb(), fb2()]);
    const result = await markDuplicate(engine, 'FB-001', { duplicateOf: 'FB-002' });
    expect(result).toEqual({ id: 'FB-001', status: 'duplicate', duplicateOf: 'FB-002', applied: 'immediate' });
    expect(statusOf(engine, 'FB-001').duplicate_of).toBe('FB-002');
  });

  test('marks a triaged feedback as a duplicate', async () => {
    const engine = new FakeEngine([fb('triaged'), fb2()]);
    await markDuplicate(engine, 'FB-001', { duplicateOf: 'FB-002' });
    expect(statusOf(engine, 'FB-001')).toMatchObject({ status: 'duplicate', duplicate_of: 'FB-002' });
  });

  test.each(['closed', 'dismissed', 'duplicate'])('rejects a %s feedback', async (status) => {
    await expect(markDuplicate(new FakeEngine([fb(status), fb2()]), 'FB-001', { duplicateOf: 'FB-002' })).rejects.toThrow(
      /only new or triaged feedback can be marked as duplicate/,
    );
  });

  test('rejects bad targets and self-duplicates', async () => {
    await expect(markDuplicate(new FakeEngine([fb()]), 'FB-001', { duplicateOf: 'FB-404' })).rejects.toThrow(/not found/);
    await expect(markDuplicate(new FakeEngine([fb(), prd()]), 'FB-001', { duplicateOf: 'PRD-001' })).rejects.toThrow(/is not Feedback/);
    await expect(markDuplicate(new FakeEngine([fb()]), 'FB-001', { duplicateOf: 'FB-001' })).rejects.toThrow(/duplicate of itself/);
  });
});

describe('closeFeedback', () => {
  const now = new Date('2026-01-02T03:04:05.000Z');

  test('closes a triaged feedback with a reason and references', async () => {
    const engine = new FakeEngine([fb('triaged')]);
    const result = await closeFeedback(engine, 'FB-001', 'agent:x', { reason: 'entregado', resolvedBy: ['WO-707', 'PR #66'], now });
    expect(result).toEqual({ id: 'FB-001', status: 'closed', reason: 'entregado', resolvedBy: ['WO-707', 'PR #66'], closedAt: now.toISOString(), applied: 'immediate' });
    expect(statusOf(engine, 'FB-001')).toMatchObject({ status: 'closed', closed_by: 'agent:x', close_reason: 'entregado' });
  });

  test('closes a new feedback without reason or references and writes neither field', async () => {
    const engine = new FakeEngine([fb()]);
    const result = await closeFeedback(engine, 'FB-001', 'agent:x', { now });
    expect(result).toMatchObject({ reason: null, resolvedBy: [], status: 'closed' });
    expect(statusOf(engine, 'FB-001')).not.toHaveProperty('close_reason');
    expect(statusOf(engine, 'FB-001')).not.toHaveProperty('resolved_by');
  });

  test.each(['closed', 'dismissed', 'duplicate'])('rejects a %s feedback naming the valid path', async (status) => {
    await expect(closeFeedback(new FakeEngine([fb(status)]), 'FB-001', 'agent:x')).rejects.toThrow(/only new or triaged feedback can be closed/);
  });

  test('rejects an invalid actor, a missing id and a non-feedback target', async () => {
    await expect(closeFeedback(new FakeEngine([fb()]), 'FB-001', 'nope')).rejects.toThrow(/invalid actor/);
    await expect(closeFeedback(new FakeEngine([prd()]), 'FB-404', 'agent:x')).rejects.toThrow(/not found/);
    await expect(closeFeedback(new FakeEngine([prd()]), 'PRD-001', 'agent:x')).rejects.toThrow(/is not Feedback/);
  });

  test('closing fields do not change the content hash or the label', () => {
    const closed = doc(
      'id: FB-001\ntype: FB\ntitle: Feedback\nstatus: closed\nclosed_at: 2026-01-02T03:04:05.000Z\nclosed_by: agent:x\nclose_reason: entregado\nresolved_by: [WO-707]',
    );
    const open = fb();
    expect(closed.node.contentHash).toBe(open.node.contentHash);
    expect(closed.node.label).toBe('Feedback');
    for (const key of ['close_reason', 'closed_at', 'closed_by', 'resolved_by']) expect(open.frontmatter).not.toHaveProperty(key);
  });

  test('reports applied: deferred for a collab-origin document', async () => {
    const engine = new FakeEngine([fb('triaged')], new Set(['FB-001']));
    const result = await closeFeedback(engine, 'FB-001', 'agent:x', { now });
    expect(result.applied).toBe('deferred');
  });
});

describe('linkFeedback', () => {
  const prd2 = (): ParsedDoc => doc('id: PRD-002\ntype: PRD\ntitle: Second', 'body', 'docs/PRD-002.md');
  const fbWith = (extra: string, status = 'new'): ParsedDoc => doc(`id: FB-001\ntype: FB\ntitle: Feedback\nstatus: ${status}\n${extra}`);

  test('requires informs or root', async () => {
    const engine = new FakeEngine([fb(), prd()]);
    await expect(linkFeedback(engine, 'FB-001', 'dev:tano', {})).rejects.toThrow(/informs.*root/);
  });

  test('rejects a missing id and a target that is not Feedback', async () => {
    await expect(linkFeedback(new FakeEngine([prd()]), 'FB-404', 'dev:tano', { root: true })).rejects.toThrow(/not found/);
    await expect(linkFeedback(new FakeEngine([prd()]), 'PRD-001', 'dev:tano', { root: true })).rejects.toThrow(/is not Feedback/);
  });

  test('rejects an invalid actor', async () => {
    await expect(linkFeedback(new FakeEngine([fb(), prd()]), 'FB-001', 'nope', { informs: ['PRD-001'] })).rejects.toThrow(/invalid actor/);
  });

  test('merges informs without overwriting what the feedback already had, and never duplicates', async () => {
    const engine = new FakeEngine([fbWith('informs: [PRD-002]'), prd(), prd2()]);
    const result = await linkFeedback(engine, 'FB-001', 'dev:tano', { informs: ['PRD-001', 'PRD-001'] });
    expect([...result.linkedTo].sort()).toEqual(['PRD-001', 'PRD-002']);
    expect((statusOf(engine, 'FB-001').informs as string[]).sort()).toEqual(['PRD-001', 'PRD-002']);
  });

  test('never changes the status of a triaged feedback', async () => {
    const engine = new FakeEngine([fb('triaged'), prd()]);
    const result = await linkFeedback(engine, 'FB-001', 'dev:tano', { informs: ['PRD-001'] });
    expect(result.status).toBe('triaged');
    expect(statusOf(engine, 'FB-001').status).toBe('triaged');
  });

  test('links a closed feedback keeping its status and close trace intact', async () => {
    const closed = fbWith('close_reason: entregado\nresolved_by: [WO-624]\nclosed_by: dev:tano', 'closed');
    const engine = new FakeEngine([closed, prd()]);
    const result = await linkFeedback(engine, 'FB-001', 'dev:tano', { informs: ['PRD-001'] });
    expect(result).toMatchObject({ id: 'FB-001', status: 'closed', linkedTo: ['PRD-001'], linkedBy: 'dev:tano' });
    expect(statusOf(engine, 'FB-001')).toMatchObject({ status: 'closed', close_reason: 'entregado', resolved_by: ['WO-624'], informs: ['PRD-001'] });
  });

  test('accepts a new feedback (linking does not require prior triage)', async () => {
    const engine = new FakeEngine([fb(), prd()]);
    const result = await linkFeedback(engine, 'FB-001', 'dev:tano', { informs: ['PRD-001'] });
    expect(result.status).toBe('new');
  });

  test('root: true without informs sets root and leaves informs intact', async () => {
    const engine = new FakeEngine([fbWith('informs: [PRD-002]'), prd2()]);
    const result = await linkFeedback(engine, 'FB-001', 'dev:tano', { root: true });
    expect(result).toMatchObject({ root: true, linkedTo: ['PRD-002'] });
    expect(statusOf(engine, 'FB-001')).toMatchObject({ root: true, informs: ['PRD-002'] });
  });

  test('rejects an informs target that is not a Feature', async () => {
    const engine = new FakeEngine([fb(), doc('id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-999]')]);
    await expect(linkFeedback(engine, 'FB-001', 'dev:tano', { informs: ['SDD-001'] })).rejects.toThrow(/must be a Feature/);
  });

  test('reports applied: immediate normally and deferred for a collab-origin document', async () => {
    const immediate = await linkFeedback(new FakeEngine([fb(), prd()]), 'FB-001', 'dev:tano', { informs: ['PRD-001'] });
    expect(immediate.applied).toBe('immediate');
    const deferred = await linkFeedback(new FakeEngine([fb(), prd()], new Set(['FB-001'])), 'FB-001', 'dev:tano', { informs: ['PRD-001'] });
    expect(deferred.applied).toBe('deferred');
  });

  test('D3: with neither informs nor root the error names the links the feedback already has', async () => {
    const closed = fbWith('informs: [PRD-001]\nroot: true\nclose_reason: entregado\nresolved_by: [WO-624]\nclosed_by: dev:tano', 'closed');
    const bc = doc('id: BC-020\ntype: BC\ntitle: Caso\njustified_by: [FB-001]', 'body', 'docs/BC-020.md');
    const engine = new FakeEngine([closed, prd(), bc]);
    const err = await linkFeedback(engine, 'FB-001', 'dev:tano', {}).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toBe(
      [
        'link_feedback requires "informs" (one or more feature ids) or "root: true". FB-001 already has:',
        '  - informs: [PRD-001]',
        '  - root: true',
        '  - cited by: [BC-020] (justified_by)',
        '  - status: closed (close_reason: "entregado"; closed_by: dev:tano; resolved_by: [WO-624])',
      ].join('\n'),
    );
  });

  test('D3: a bare new feedback gets the simple one-line message', async () => {
    const err = await linkFeedback(new FakeEngine([fb()]), 'FB-001', 'dev:tano', {}).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toBe('link_feedback requires "informs" (one or more feature ids) or "root: true"');
    expect(err.message).not.toContain('already has');
  });
});

describe('triageFeedbackBatch', () => {
  test('dedupes ids, keeps input order and reports per-item failures without aborting', async () => {
    const engine = new FakeEngine([fb()]);
    const result = await triageFeedbackBatch(engine, { action: 'dismiss', ids: ['FB-001', 'FB-001', 'FB-404'] });
    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.id)).toEqual(['FB-001', 'FB-404']);
    expect(result.results[0]).toEqual({ id: 'FB-001', ok: true });
    expect(result.results[1]).toMatchObject({ id: 'FB-404', ok: false });
    expect(result.results[1]!.error).toMatch(/not found/);
    expect(result).toMatchObject({ ok: 1, failed: 1 });
  });

  test('duplicate without duplicateOf is rejected', async () => {
    await expect(triageFeedbackBatch(new FakeEngine([fb()]), { action: 'duplicate', ids: ['FB-001'] })).rejects.toThrow(/requires "duplicateOf"/);
  });

  test('duplicate with duplicateOf links every item', async () => {
    const engine = new FakeEngine([fb(), fb2()]);
    const result = await triageFeedbackBatch(engine, { action: 'duplicate', ids: ['FB-001'], duplicateOf: 'FB-002' });
    expect(result.ok).toBe(1);
    expect(statusOf(engine, 'FB-001').duplicate_of).toBe('FB-002');
  });
});
