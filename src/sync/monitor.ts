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
  | 'governs_warning';

export interface DriftIssue {
  kind: IssueKind;
  severity: 'error' | 'warning';
  nodeId: string;
  target?: string;
  message: string;
}

export type GovernedReason = 'unchanged' | 'new' | 'resolved_by_commit' | 'code_changed' | 'missing' | 'blueprint_changed';

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

class DriftContext {
  readonly byId: Map<string, ParsedDoc>;
  readonly baseline: Baseline;

  constructor(readonly input: DriftInput) {
    this.byId = new Map(input.docs.map((d) => [d.node.id, d]));
    this.baseline = reconcileBaseline(input);
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

  isStale(wo: WorkOrderDoc): boolean {
    return wo.frontmatter.implements.some((bp) => this.byId.get(bp)?.node.label === 'Blueprint' && !this.workOrderCurrentFor(wo, bp));
  }

  coveredByCommit(path: string, blueprintId: string): boolean {
    if (this.input.dirty.has(path)) return false;
    const latest = this.input.commits.find((c) => c.files.includes(path));
    if (!latest) return false;
    return latest.refs.some((id) => {
      const wo = this.byId.get(id);
      return (
        wo !== undefined &&
        isWorkOrder(wo) &&
        wo.frontmatter.implements.includes(blueprintId) &&
        wo.frontmatter.status === 'done' &&
        this.workOrderCurrentFor(wo, blueprintId)
      );
    });
  }
}

export function detectDrift(input: DriftInput): DriftResult {
  const ctx = new DriftContext(input);
  const governed = evaluateGoverned(ctx);
  const workOrderUpdates = evaluateWorkOrders(ctx);
  const reviewNeeded = evaluateFeatures(ctx);
  const finalStatus = new Map(workOrderUpdates.map((u) => [u.id, u.to]));

  const issues: DriftIssue[] = [
    ...linkIssues(ctx),
    ...reviewNeeded
      .map((r) => r.featureId)
      .filter((id, i, all) => all.indexOf(id) === i)
      .map((id): DriftIssue => ({ kind: 'feature_changed', severity: 'error', nodeId: id, message: `${id} changed since its last acknowledged version; review its blueprints` })),
    ...input.docs
      .filter((d) => d.node.label === 'Blueprint' && ctx.changed(d.node.id))
      .map((d): DriftIssue => ({ kind: 'blueprint_changed', severity: 'error', nodeId: d.node.id, message: `${d.node.id} changed since its last acknowledged version` })),
    ...governed
      .filter((g) => g.status === 'out_of_sync')
      .map((g): DriftIssue => ({ kind: 'code_out_of_sync', severity: 'error', nodeId: g.blueprintId, target: g.key, message: `${g.key} is out of sync with ${g.blueprintId} (${g.reason})` })),
    ...input.docs
      .filter(isWorkOrder)
      .filter((wo) => (finalStatus.get(wo.node.id) ?? wo.frontmatter.status) === 'out_of_sync')
      .map((wo): DriftIssue => ({ kind: 'work_order_out_of_sync', severity: 'error', nodeId: wo.node.id, message: `${wo.node.id} was completed against an older version of its blueprint` })),
    ...input.governWarnings.map((w): DriftIssue => ({ kind: 'governs_warning', severity: 'warning', nodeId: w.blueprintId, message: w.message })),
  ];

  return { governed, reviewNeeded, workOrderUpdates, issues, baseline: ctx.baseline };
}

function evaluateGoverned(ctx: DriftContext): GovernedState[] {
  const states: GovernedState[] = [];
  for (const [blueprintId, refs] of ctx.input.governed) {
    const bpChanged = ctx.changed(blueprintId);
    for (const ref of refs) {
      const base = ctx.input.baseline.governs[blueprintId]?.[ref.key];
      const resolve = (failure: GovernedReason): Pick<GovernedState, 'status' | 'reason'> =>
        ctx.coveredByCommit(ref.path, blueprintId) ? { status: 'synced', reason: 'resolved_by_commit' } : { status: 'out_of_sync', reason: failure };
      let verdict: Pick<GovernedState, 'status' | 'reason'>;
      if (ref.hash === null) verdict = resolve('missing');
      else if (bpChanged) verdict = resolve('blueprint_changed');
      else if (base === undefined) verdict = { status: 'synced', reason: 'new' };
      else if (base !== ref.hash) verdict = resolve('code_changed');
      else verdict = { status: 'synced', reason: 'unchanged' };
      states.push({ blueprintId, key: ref.key, path: ref.path, symbol: ref.symbol, ...verdict });
    }
  }
  return states;
}

function evaluateWorkOrders(ctx: DriftContext): WorkOrderUpdate[] {
  return ctx.input.docs.filter(isWorkOrder).flatMap((wo): WorkOrderUpdate[] => {
    const from = wo.frontmatter.status;
    if (from !== 'done' && from !== 'out_of_sync') return [];
    const to: WorkOrderStatus = ctx.isStale(wo) ? 'out_of_sync' : 'done';
    return to === from ? [] : [{ id: wo.node.id, sourcePath: wo.node.sourcePath, from, to }];
  });
}

function evaluateFeatures(ctx: DriftContext): { blueprintId: string; featureId: string }[] {
  const changedFeatures = new Set(ctx.input.docs.filter((d) => d.node.label === 'Feature' && ctx.changed(d.node.id)).map((d) => d.node.id));
  return ctx.input.docs.flatMap((d) =>
    d.edges.filter((e) => e.type === 'ARCHITECTS' && changedFeatures.has(e.to)).map((e) => ({ blueprintId: d.node.id, featureId: e.to })),
  );
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

/** Adds never-seen docs/code refs as acknowledged and prunes entries that no longer exist; existing entries are kept untouched. */
function reconcileBaseline(input: DriftInput): Baseline {
  const docs: Record<string, string> = {};
  for (const d of input.docs) docs[d.node.id] = input.baseline.docs[d.node.id] ?? d.node.contentHash;
  const governs: Baseline['governs'] = {};
  for (const [blueprintId, refs] of input.governed) {
    if (!docs[blueprintId]) continue;
    const previous = input.baseline.governs[blueprintId] ?? {};
    governs[blueprintId] = Object.fromEntries(refs.map((r) => [r.key, r.key in previous ? (previous[r.key] ?? null) : r.hash]));
  }
  return { version: 1, docs, governs };
}

export interface AcknowledgeResult {
  baseline: Baseline;
  workOrderHashUpdates: { id: string; sourcePath: string; blueprintHashes: Record<string, string> }[];
}

export function acknowledge(input: DriftInput, target: string): AcknowledgeResult {
  const ctx = new DriftContext(input);
  const all = target === 'all';
  if (!all && !ctx.byId.has(target)) throw new Error(`unknown acknowledge target: ${target}`);

  const blueprintIds = all ? [...input.governed.keys()].filter((id) => ctx.byId.has(id)) : ctx.byId.get(target)?.node.label === 'Blueprint' ? [target] : [];
  const docIds = all ? input.docs.map((d) => d.node.id) : [target];

  const docs = { ...ctx.baseline.docs };
  for (const id of docIds) docs[id] = ctx.hashOf(id) ?? '';
  const governs = { ...ctx.baseline.governs };
  for (const bp of blueprintIds) governs[bp] = Object.fromEntries((input.governed.get(bp) ?? []).map((r) => [r.key, r.hash]));

  const workOrderHashUpdates = input.docs
    .filter(isWorkOrder)
    .filter((wo) => wo.frontmatter.status === 'done' || wo.frontmatter.status === 'out_of_sync')
    .flatMap((wo) => {
      const acked = wo.frontmatter.implements.filter((bp) => blueprintIds.includes(bp) || (all && ctx.byId.get(bp)?.node.label === 'Blueprint'));
      if (acked.length === 0) return [];
      const blueprintHashes = { ...wo.frontmatter.blueprint_hashes };
      for (const bp of acked) blueprintHashes[bp] = ctx.hashOf(bp) ?? '';
      return [{ id: wo.node.id, sourcePath: wo.node.sourcePath, blueprintHashes }];
    });

  return { baseline: { version: 1, docs, governs }, workOrderHashUpdates };
}
