import type { DocRelType, NodeLabel, ParsedDoc, WorkOrderStatus } from '../domain/schema.js';
import type { Baseline } from './baseline.js';
import type { CodeRefState } from './code-refs.js';
import type { CommitInfo } from './git.js';

export interface DriftInput {
  docs: ParsedDoc[];
  governed: Map<string, CodeRefState[]>;
  governWarnings: { blueprintId: string; message: string }[];
  baseline: Baseline;
  commits: CommitInfo[];
  dirty: Set<string>;
}

export type IssueKind =
  | 'broken_link'
  | 'invalid_link_target'
  | 'feature_changed'
  | 'blueprint_changed'
  | 'code_out_of_sync'
  | 'work_order_out_of_sync'
  | 'status_write_failed'
  | 'governs_warning';

export interface DriftIssue {
  kind: IssueKind;
  severity: 'error' | 'warning';
  nodeId: string;
  target?: string;
  message: string;
}

export type GovernedReason = 'unchanged' | 'new' | 'resolved_by_commit' | 'code_changed' | 'missing' | 'blueprint_changed' | 'feature_changed';

export interface GovernedState {
  blueprintId: string;
  key: string;
  path: string;
  symbol: string | null;
  status: 'synced' | 'out_of_sync';
  reason: GovernedReason;
}

export interface WorkOrderUpdate {
  id: string;
  sourcePath: string;
  from: WorkOrderStatus;
  to: WorkOrderStatus;
}

export interface DriftResult {
  governed: GovernedState[];
  reviewNeeded: { blueprintId: string; featureId: string }[];
  workOrderUpdates: WorkOrderUpdate[];
  issues: DriftIssue[];
  baseline: Baseline;
}

const EXPECTED_TARGET: Readonly<Record<DocRelType, NodeLabel>> = {
  EVOLVES_FROM: 'Feature',
  ARCHITECTS: 'Feature',
  IMPLEMENTS: 'Blueprint',
  PROVIDES_CONTEXT_FOR: 'Feature',
  INFORMS: 'Feature',
};

type WorkOrderDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'WO' }> };
const isWorkOrder = (d: ParsedDoc): d is WorkOrderDoc => d.frontmatter.type === 'WO';
const isFinished = (wo: WorkOrderDoc): boolean => wo.frontmatter.status === 'done' || wo.frontmatter.status === 'out_of_sync';

class DriftContext {
  readonly byId: Map<string, ParsedDoc>;
  /** Current refs plus refs remembered in the baseline that no longer resolve, so vanished code is reported instead of silently pruned. */
  readonly governed: Map<string, CodeRefState[]>;

  constructor(readonly input: DriftInput) {
    this.byId = new Map(input.docs.map((d) => [d.node.id, d]));
    this.governed = new Map(
      [...input.governed].map(([bp, refs]) => {
        const known = new Set(refs.map((r) => r.key));
        const vanished = Object.keys(input.baseline.governs[bp] ?? {})
          .filter((key) => !known.has(key))
          .map((key): CodeRefState => ({ key, path: key.split('#')[0] ?? key, symbol: key.includes('#') ? key.slice(key.indexOf('#') + 1) : null, hash: null }));
        return [bp, [...refs, ...vanished]];
      }),
    );
  }

  /** Blueprints architecting a requirement that evolved since its acknowledged version: their code may now be legacy. */
  blueprintsOfChangedFeatures(): Set<string> {
    const changed = new Set(this.input.docs.filter((d) => d.node.label === 'Feature' && this.changed(d.node.id)).map((d) => d.node.id));
    return new Set(this.input.docs.filter((d) => d.edges.some((e) => e.type === 'ARCHITECTS' && changed.has(e.to))).map((d) => d.node.id));
  }

  hashOf(id: string): string | undefined {
    return this.byId.get(id)?.node.contentHash;
  }

  changed(id: string): boolean {
    const base = this.input.baseline.docs[id];
    return base !== undefined && base !== this.hashOf(id);
  }

  workOrderCurrentFor(wo: WorkOrderDoc, blueprintId: string): boolean {
    const recorded = wo.frontmatter.blueprint_hashes[blueprintId];
    return recorded !== undefined ? recorded === this.hashOf(blueprintId) : !this.changed(blueprintId);
  }

  /** An out_of_sync work order only recovers through explicit evidence: re-completion or an individual ack recording current blueprint hashes. */
  recordedCurrent(wo: WorkOrderDoc): boolean {
    return wo.frontmatter.implements
      .filter((bp) => this.byId.get(bp)?.node.label === 'Blueprint')
      .every((bp) => wo.frontmatter.blueprint_hashes[bp] === this.hashOf(bp));
  }

  isStale(wo: WorkOrderDoc): boolean {
    return wo.frontmatter.implements.some((bp) => this.byId.get(bp)?.node.label === 'Blueprint' && !this.workOrderCurrentFor(wo, bp));
  }

  coveredByCommit(path: string, blueprintId: string): boolean {
    if (this.input.dirty.has(path)) return false;
    const latest = this.input.commits.find((c) => c.files.includes(path));
    if (!latest) return false;
    return this.input.docs.filter(isWorkOrder).some(
      (wo) =>
        isFinished(wo) &&
        wo.frontmatter.implements.includes(blueprintId) &&
        this.workOrderCurrentFor(wo, blueprintId) &&
        (latest.refs.includes(wo.node.id) || wo.frontmatter.resolved_by.some((sha) => latest.sha.startsWith(sha) || sha.startsWith(latest.sha))),
    );
  }
}

export function detectDrift(input: DriftInput): DriftResult {
  const ctx = new DriftContext(input);
  const governed = evaluateGoverned(ctx);
  const workOrderUpdates = evaluateWorkOrders(ctx);
  const changedFeatures = input.docs.filter((d) => d.node.label === 'Feature' && ctx.changed(d.node.id)).map((d) => d.node.id);
  const reviewNeeded = input.docs.flatMap((d) =>
    d.edges.filter((e) => e.type === 'ARCHITECTS' && changedFeatures.includes(e.to)).map((e) => ({ blueprintId: d.node.id, featureId: e.to })),
  );
  const issues = collectIssues(ctx, governed, workOrderUpdates, changedFeatures);
  return { governed, reviewNeeded, workOrderUpdates, issues, baseline: reconcileBaseline(ctx, governed) };
}

function collectIssues(ctx: DriftContext, governed: GovernedState[], updates: WorkOrderUpdate[], changedFeatures: string[]): DriftIssue[] {
  const finalStatus = new Map(updates.map((u) => [u.id, u.to]));
  return [
    ...linkIssues(ctx),
    ...changedFeatures.map((id): DriftIssue => ({ kind: 'feature_changed', severity: 'error', nodeId: id, message: `${id} changed since its last acknowledged version; review its blueprints` })),
    ...ctx.input.docs
      .filter((d) => d.node.label === 'Blueprint' && ctx.changed(d.node.id))
      .map((d): DriftIssue => ({ kind: 'blueprint_changed', severity: 'error', nodeId: d.node.id, message: `${d.node.id} changed since its last acknowledged version` })),
    ...governed
      .filter((g) => g.status === 'out_of_sync')
      .map((g): DriftIssue => ({ kind: 'code_out_of_sync', severity: 'error', nodeId: g.blueprintId, target: g.key, message: `${g.key} is out of sync with ${g.blueprintId} (${g.reason})` })),
    ...ctx.input.docs
      .filter(isWorkOrder)
      .filter((wo) => (finalStatus.get(wo.node.id) ?? wo.frontmatter.status) === 'out_of_sync')
      .map((wo): DriftIssue => ({ kind: 'work_order_out_of_sync', severity: 'error', nodeId: wo.node.id, message: `${wo.node.id} was completed against an older version of its blueprint` })),
    ...ctx.input.governWarnings.map((w): DriftIssue => ({ kind: 'governs_warning', severity: 'warning', nodeId: w.blueprintId, message: w.message })),
  ];
}

function evaluateGoverned(ctx: DriftContext): GovernedState[] {
  const legacyBlueprints = ctx.blueprintsOfChangedFeatures();
  return [...ctx.governed].flatMap(([blueprintId, refs]) => {
    const bpChanged = ctx.changed(blueprintId);
    return refs.map((ref): GovernedState => {
      const base = ctx.input.baseline.governs[blueprintId]?.[ref.key];
      const resolve = (failure: GovernedReason): Pick<GovernedState, 'status' | 'reason'> =>
        ctx.coveredByCommit(ref.path, blueprintId) ? { status: 'synced', reason: 'resolved_by_commit' } : { status: 'out_of_sync', reason: failure };
      let verdict: Pick<GovernedState, 'status' | 'reason'>;
      if (ref.hash === null) verdict = resolve('missing');
      else if (bpChanged) verdict = resolve('blueprint_changed');
      else if (legacyBlueprints.has(blueprintId)) verdict = { status: 'out_of_sync', reason: 'feature_changed' };
      else if (base === undefined) verdict = { status: 'synced', reason: 'new' };
      else if (base !== ref.hash) verdict = resolve('code_changed');
      else verdict = { status: 'synced', reason: 'unchanged' };
      return { blueprintId, key: ref.key, path: ref.path, symbol: ref.symbol, ...verdict };
    });
  });
}

function evaluateWorkOrders(ctx: DriftContext): WorkOrderUpdate[] {
  return ctx.input.docs.filter(isWorkOrder).flatMap((wo): WorkOrderUpdate[] => {
    const from = wo.frontmatter.status;
    if (from !== 'done' && from !== 'out_of_sync') return [];
    const to: WorkOrderStatus = from === 'done' ? (ctx.isStale(wo) ? 'out_of_sync' : 'done') : ctx.recordedCurrent(wo) ? 'done' : 'out_of_sync';
    return to === from ? [] : [{ id: wo.node.id, sourcePath: wo.node.sourcePath, from, to }];
  });
}

function linkIssues(ctx: DriftContext): DriftIssue[] {
  return ctx.input.docs.flatMap((d) =>
    d.edges.flatMap((e): DriftIssue[] => {
      const target = ctx.byId.get(e.to);
      if (!target) return [{ kind: 'broken_link', severity: 'error', nodeId: d.node.id, target: e.to, message: `${d.node.id} links to missing ${e.to} (${e.type})` }];
      if (target.node.label !== EXPECTED_TARGET[e.type]) {
        return [{ kind: 'invalid_link_target', severity: 'error', nodeId: d.node.id, target: e.to, message: `${e.type} from ${d.node.id} must target a ${EXPECTED_TARGET[e.type]}, got ${target.node.label}` }];
      }
      return [];
    }),
  );
}

/**
 * Records never-seen docs/code as acknowledged, advances code hashes resolved by a work order commit,
 * keeps vanished-but-unresolved refs, and prunes documents and blueprints that no longer exist.
 */
function reconcileBaseline(ctx: DriftContext, states: GovernedState[]): Baseline {
  const { input } = ctx;
  const docs = Object.fromEntries(input.docs.map((d) => [d.node.id, input.baseline.docs[d.node.id] ?? d.node.contentHash]));
  const governs: Baseline['governs'] = {};
  for (const [blueprintId, refs] of ctx.governed) {
    if (!docs[blueprintId]) continue;
    const previous = input.baseline.governs[blueprintId] ?? {};
    const entries = refs.flatMap((ref): [string, string | null][] => {
      const state = states.find((s) => s.blueprintId === blueprintId && s.key === ref.key);
      if (state?.reason === 'resolved_by_commit') return ref.hash === null ? [] : [[ref.key, ref.hash]];
      return [[ref.key, ref.key in previous ? (previous[ref.key] ?? null) : ref.hash]];
    });
    governs[blueprintId] = Object.fromEntries(entries);
  }
  return { version: 1, docs, governs };
}

export interface AcknowledgeResult {
  baseline: Baseline;
  workOrderHashUpdates: { id: string; sourcePath: string; blueprintHashes: Record<string, string> }[];
}

/**
 * Accepts the current state of one document (or "all").
 * A blueprint ack re-baselines the blueprint and its code only: finished work orders built on the old design stay
 * out_of_sync until they are re-completed or acknowledged individually by id.
 */
export function acknowledge(input: DriftInput, target: string): AcknowledgeResult {
  const ctx = new DriftContext(input);
  const all = target === 'all';
  const targetDoc = ctx.byId.get(target);
  if (!all && !targetDoc) throw new Error(`unknown acknowledge target: ${target}`);
  if (targetDoc && isWorkOrder(targetDoc) && !isFinished(targetDoc)) {
    throw new Error(`${target} is ${targetDoc.frontmatter.status}; only done or out_of_sync work orders can be acknowledged`);
  }

  const current = detectDrift(input).baseline;
  const docIds = all ? input.docs.map((d) => d.node.id) : [target];
  const blueprintIds = all ? [...input.governed.keys()].filter((id) => ctx.byId.has(id)) : targetDoc?.node.label === 'Blueprint' ? [target] : [];
  const docs = { ...current.docs, ...Object.fromEntries(docIds.map((id) => [id, ctx.hashOf(id) ?? ''])) };
  const governs = {
    ...current.governs,
    ...Object.fromEntries(blueprintIds.map((bp) => [bp, Object.fromEntries((input.governed.get(bp) ?? []).map((r) => [r.key, r.hash]))])),
  };

  const workOrders = all ? input.docs.filter(isWorkOrder).filter(isFinished) : targetDoc && isWorkOrder(targetDoc) ? [targetDoc] : [];
  const workOrderHashUpdates = workOrders.flatMap((wo) => {
    const blueprints = wo.frontmatter.implements.filter((bp) => ctx.byId.get(bp)?.node.label === 'Blueprint');
    if (blueprints.length === 0) return [];
    const blueprintHashes = { ...wo.frontmatter.blueprint_hashes, ...Object.fromEntries(blueprints.map((bp) => [bp, ctx.hashOf(bp) ?? ''])) };
    return [{ id: wo.node.id, sourcePath: wo.node.sourcePath, blueprintHashes }];
  });

  return { baseline: { version: 1, docs, governs }, workOrderHashUpdates };
}
