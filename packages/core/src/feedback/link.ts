import { z } from 'zod';
import { ACTOR_PATTERN, docId } from '../domain/schema.js';
import type { EngineOps, ProjectEngine } from '../engine.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';

const triageFeedbackSchema = z.object({
  /** Feature ids this feedback should now link to via `informs`, merged with whatever it already has. */
  informs: z.array(docId).optional(),
  /** Same root exemption `createFeatureRequest`'s target validation already respects for Artifact/Feedback. */
  root: z.boolean().optional(),
});

export type TriageFeedbackInput = z.input<typeof triageFeedbackSchema>;

export interface TriageFeedbackResult {
  id: string;
  linkedTo: string[];
  root: boolean;
  /** `'immediate'`: the link is already visible on `published_raw` (a `generated`-origin document, or
   * any local `Engine` document — there is no working-copy concept outside the SaaS `collab` origin).
   * `'deferred'`: the link was queued in `pending_editable_patch` (a `collab`-origin document with a
   * working copy) and only takes effect once that document is next republished. Derived from whether
   * `ops.updateDocument`'s own returned document already reflects the write — `triageFeedback` never
   * needs to know about `origin`/`pending_editable_patch` itself, the same "domain code depends only on
   * EngineOps" boundary every other function in this package already keeps. */
  applied: 'immediate' | 'deferred';
}

async function validateInformsTargets(ops: EngineOps, informs: readonly string[]): Promise<void> {
  const scan = await ops.scan();
  for (const featureId of informs) {
    const target = scan.docs.find((d) => d.node.id === featureId);
    if (!target) throw new Error(`informs target ${featureId} not found`);
    if (target.node.label !== 'Feature') throw new Error(`informs target ${featureId} must be a Feature, got ${target.node.label}`);
  }
}

/**
 * Triages a `new` Feedback document (SDD-012 "Centurion Factory conectado al backend SaaS", WO-330):
 * links it to one or more features (`informs`, merged with whatever it already has) and/or marks it
 * `root: true`, the same target-validation pattern `createFeatureRequest`
 * (`packages/core/src/feedback/ingest.ts`) already uses for a `justified_by`/`feedbackId` link, then sets
 * `status: 'triaged'` (a plain string field, not lifecycle-managed — no schema change needed). At least
 * one of `informs`/`root` is required, mirroring `createFeatureRequest`'s own "requires justified_by" gate.
 */
export async function triageFeedback(engine: ProjectEngine, id: string, input: TriageFeedbackInput): Promise<TriageFeedbackResult> {
  const parsed = triageFeedbackSchema.parse(input);
  const informs = [...new Set(parsed.informs ?? [])];
  if (informs.length === 0 && parsed.root !== true) {
    throw new Error('triage_feedback requires "informs" (one or more feature ids) or "root: true"');
  }

  return engine.transaction(
    async (ops) => {
      const scan = await ops.scan();
      const feedback = scan.docs.find((d) => d.node.id === id);
      if (!feedback) throw new Error(`feedback ${id} not found`);
      if (feedback.node.label !== 'Feedback' || feedback.frontmatter.type !== 'FB') throw new Error(`${id} is not Feedback`);
      if (feedback.frontmatter.status !== 'new') throw new Error(`${id} is "${feedback.frontmatter.status}"; only new feedback can be triaged`);

      await validateInformsTargets(ops, informs);

      const linkedTo = [...new Set([...feedback.frontmatter.informs, ...informs])];
      const fields: Record<string, FieldValue> = { informs: linkedTo, status: 'triaged' };
      if (parsed.root !== undefined) fields.root = parsed.root;

      const updated = await ops.updateDocument(id, fields);
      await ops.refresh();

      const applied: TriageFeedbackResult['applied'] = updated.frontmatter.type === 'FB' && updated.frontmatter.status === 'triaged' ? 'immediate' : 'deferred';
      return { id, linkedTo, root: parsed.root ?? false, applied };
    },
    { atomic: true },
  );
}

export const TRIAGE_BATCH_MAX_IDS = 200;
const REASON_MAX = 2000;

const dismissFeedbackSchema = z.object({ reason: z.string().max(REASON_MAX).optional() }).default({});
const markDuplicateSchema = z.object({ duplicateOf: docId });
const triageBatchSchema = z.object({
  action: z.enum(['dismiss', 'duplicate']),
  ids: z.array(docId).min(1).max(TRIAGE_BATCH_MAX_IDS),
  reason: z.string().max(REASON_MAX).optional(),
  duplicateOf: docId.optional(),
});

export type DismissFeedbackInput = z.input<typeof dismissFeedbackSchema>;
export type MarkDuplicateInput = z.input<typeof markDuplicateSchema>;
export type TriageBatchInput = z.input<typeof triageBatchSchema>;

export interface DismissFeedbackResult {
  id: string;
  status: 'dismissed';
  reason: string | null;
  /** Same meaning as `TriageFeedbackResult.applied`. */
  applied: 'immediate' | 'deferred';
}

export interface MarkDuplicateResult {
  id: string;
  status: 'duplicate';
  duplicateOf: string;
  applied: 'immediate' | 'deferred';
}

export interface TriageBatchItemResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface TriageBatchResult {
  action: 'dismiss' | 'duplicate';
  /** In the order of the (deduplicated) input ids. */
  results: TriageBatchItemResult[];
  ok: number;
  failed: number;
}

type Scan = Awaited<ReturnType<EngineOps['scan']>>;

/** Shared by the single and batch paths: the target must exist, be a Feedback and still be `new` or `triaged` (WO-330/D4). */
function requireOpenFeedback(scan: Scan, id: string, verb: string): void {
  const feedback = scan.docs.find((d) => d.node.id === id);
  if (!feedback) throw new Error(`feedback ${id} not found`);
  if (feedback.node.label !== 'Feedback' || feedback.frontmatter.type !== 'FB') throw new Error(`${id} is not Feedback`);
  const status = feedback.frontmatter.status;
  if (status !== 'new' && status !== 'triaged') throw new Error(`${id} is "${status}"; only new or triaged feedback can be ${verb}`);
}

function requireDuplicateTarget(scan: Scan, duplicateOf: string): void {
  const target = scan.docs.find((d) => d.node.id === duplicateOf);
  if (!target) throw new Error(`duplicate target ${duplicateOf} not found`);
  if (target.node.label !== 'Feedback') throw new Error(`duplicate target ${duplicateOf} is not Feedback`);
}

async function writeStatus(ops: EngineOps, id: string, status: 'dismissed' | 'duplicate', fields: Record<string, FieldValue>): Promise<'immediate' | 'deferred'> {
  const updated = await ops.updateDocument(id, { status, ...fields });
  return updated.frontmatter.type === 'FB' && updated.frontmatter.status === status ? 'immediate' : 'deferred';
}

async function applyDismiss(ops: EngineOps, scan: Scan, id: string, reason: string | undefined): Promise<DismissFeedbackResult> {
  requireOpenFeedback(scan, id, 'dismissed');
  const applied = await writeStatus(ops, id, 'dismissed', reason !== undefined ? { dismiss_reason: reason } : {});
  return { id, status: 'dismissed', reason: reason ?? null, applied };
}

async function applyDuplicate(ops: EngineOps, scan: Scan, id: string, duplicateOf: string): Promise<MarkDuplicateResult> {
  requireOpenFeedback(scan, id, 'marked as duplicate');
  if (duplicateOf === id) throw new Error(`feedback ${id} cannot be a duplicate of itself`);
  requireDuplicateTarget(scan, duplicateOf);
  const applied = await writeStatus(ops, id, 'duplicate', { duplicate_of: duplicateOf });
  return { id, status: 'duplicate', duplicateOf, applied };
}

/** SDD-065 D5: discards a `new` or `triaged` Feedback (nothing is deleted — it keeps `status: 'dismissed'` in the graph). */
export async function dismissFeedback(engine: ProjectEngine, id: string, input?: DismissFeedbackInput): Promise<DismissFeedbackResult> {
  const { reason } = dismissFeedbackSchema.parse(input);
  return engine.transaction(
    async (ops) => {
      const result = await applyDismiss(ops, await ops.scan(), id, reason);
      await ops.refresh();
      return result;
    },
    { atomic: true },
  );
}

/** SDD-065 D5: marks a `new` or `triaged` Feedback as a duplicate of another Feedback (`duplicate_of`). */
export async function markDuplicate(engine: ProjectEngine, id: string, input: MarkDuplicateInput): Promise<MarkDuplicateResult> {
  const { duplicateOf } = markDuplicateSchema.parse(input);
  return engine.transaction(
    async (ops) => {
      const result = await applyDuplicate(ops, await ops.scan(), id, duplicateOf);
      await ops.refresh();
      return result;
    },
    { atomic: true },
  );
}

/** Mirrors `MAX_CLOSE_RESOLVED_BY` in `@prdm/contracts` (core never imports contracts). */
const MAX_CLOSE_RESOLVED_BY = 20;

const closeFeedbackSchema = z.object({
  reason: z.string().max(REASON_MAX).optional(),
  resolvedBy: z.array(z.string().min(1).max(300)).max(MAX_CLOSE_RESOLVED_BY).optional(),
});

export interface CloseFeedbackOptions {
  reason?: string;
  /** Free references (`WO-xxx`, `PR #nn`, a sha) that resolved the feedback. */
  resolvedBy?: string[];
  now?: Date;
}

export interface CloseFeedbackResult {
  id: string;
  status: 'closed';
  reason: string | null;
  resolvedBy: string[];
  closedAt: string;
  /** Same meaning as `TriageFeedbackResult.applied`. */
  applied: 'immediate' | 'deferred';
}

/**
 * SDD-092 D3: closes a `new` or `triaged` Feedback as resolved (terminal `status: 'closed'`), recording
 * who closed it, when, why and by which references. Nothing is deleted. Mirrors `archiveWorkOrder`: the
 * fields it writes (`closed_at`, `closed_by`, `close_reason`, `resolved_by`) are forbidden for plain
 * authoring, so closing is a lifecycle function. Terminal feedback (`closed`/`dismissed`/`duplicate`)
 * is rejected.
 */
export async function closeFeedback(engine: ProjectEngine, id: string, by: string, options: CloseFeedbackOptions = {}): Promise<CloseFeedbackResult> {
  if (!ACTOR_PATTERN.test(by)) throw new Error(`invalid actor: ${by} (expected agent:name or dev:name)`);
  const { reason, resolvedBy = [] } = closeFeedbackSchema.parse({ reason: options.reason, resolvedBy: options.resolvedBy });
  const closedAt = (options.now ?? new Date()).toISOString();

  return engine.transaction(
    async (ops) => {
      const scan = await ops.scan();
      const feedback = scan.docs.find((d) => d.node.id === id);
      if (!feedback) throw new Error(`feedback ${id} not found`);
      if (feedback.node.label !== 'Feedback' || feedback.frontmatter.type !== 'FB') throw new Error(`${id} is not Feedback`);
      const status = feedback.frontmatter.status;
      if (status !== 'new' && status !== 'triaged') {
        throw new Error(`cannot close ${id}: status is "${status}" (terminal); only new or triaged feedback can be closed`);
      }

      const fields: Record<string, FieldValue> = { status: 'closed', closed_at: closedAt, closed_by: by };
      if (reason !== undefined) fields.close_reason = reason;
      if (resolvedBy.length > 0) fields.resolved_by = resolvedBy;

      const updated = await ops.updateDocument(id, fields);
      await ops.refresh();

      const applied: CloseFeedbackResult['applied'] = updated.frontmatter.type === 'FB' && updated.frontmatter.status === 'closed' ? 'immediate' : 'deferred';
      return { id, status: 'closed', reason: reason ?? null, resolvedBy, closedAt, applied };
    },
    { atomic: true },
  );
}

/**
 * SDD-065 D5: applies one action to many Feedback ids in a single transaction (one scan, one refresh).
 * A bad item is reported in its own result and never aborts the rest — the caller shows per-item outcomes.
 */
export async function triageFeedbackBatch(engine: ProjectEngine, input: TriageBatchInput): Promise<TriageBatchResult> {
  const parsed = triageBatchSchema.parse(input);
  const { action, reason, duplicateOf } = parsed;
  if (action === 'duplicate' && duplicateOf === undefined) throw new Error('triage_batch action "duplicate" requires "duplicateOf"');
  const ids = [...new Set(parsed.ids)];

  return engine.transaction(
    async (ops) => {
      const scan = await ops.scan();
      if (action === 'duplicate' && duplicateOf !== undefined) requireDuplicateTarget(scan, duplicateOf);

      const results: TriageBatchItemResult[] = [];
      for (const id of ids) {
        try {
          if (action === 'dismiss') await applyDismiss(ops, scan, id, reason);
          else await applyDuplicate(ops, scan, id, duplicateOf as string);
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const ok = results.filter((r) => r.ok).length;
      if (ok > 0) await ops.refresh();
      return { action, results, ok, failed: results.length - ok };
    },
    { atomic: true },
  );
}
