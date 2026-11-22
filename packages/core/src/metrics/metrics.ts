import { ageDaysFrom } from '../graph/work-order-age.js';
import { FEATURE_KIND_ORDER, FEATURE_TREE_KINDS, type FeatureKind } from '../domain/schema.js';
import { computeCapacities, type Capacities } from '../lifecycle/check.js';
import type { ParsedDoc } from '../domain/schema.js';
import type { CommitsWindow, GraphStore, MetricsRaw, OrphanFeature, UntracedCommits } from '../graph/types.js';

const COMPLETED_STATUSES = new Set(['done', 'out_of_sync']);
const MS_PER_HOUR = 3_600_000;
const STALE_PENDING_DAYS = 7;
export const SLOW_RESOLUTION_HOURS = 24;
export const SLOW_RESOLUTION_ITEMS = 10;
const P90_FRACTION = 0.9;

export type UnmeasuredReason = 'missing_claim' | 'missing_completion' | 'invalid_timestamp' | 'negative_duration';

export interface UnmeasuredWorkOrder {
  id: string;
  status: MetricsRaw['workOrders'][number]['status'];
  reason: UnmeasuredReason;
  claimedAt: string | null;
  completedAt: string | null;
}

export interface SlowOrder {
  id: string;
  claimedAt: string;
  completedAt: string;
  resolutionHours: number;
}

interface MeasuredOrder {
  id: string;
  claimedAt: string;
  completedAt: string;
  hours: number;
}

export interface AgentHumanEfficiency {
  completedWorkOrders: number;
  measuredWorkOrders: number;
  avgResolutionHours: number | null;
  medianResolutionHours: number | null;
  p90ResolutionHours: number | null;
  maxResolutionHours: number | null;
  slowest: { thresholdHours: number; total: number; items: SlowOrder[] };
  unmeasured: { total: number; workOrders: UnmeasuredWorkOrder[] };
}

export interface SystemIntegrity {
  governedTotal: number;
  governedSynced: number;
  syncedPercent: number | null;
}

export interface FeatureKindBreakdown {
  kind: FeatureKind;
  total: number;
  traced: number;
}

export interface Traceability {
  featuresByKind: FeatureKindBreakdown[];
  featuresTotal: number;
  featuresTraced: number;
  orphanFeatures: OrphanFeature[];
  featurePercent: number | null;
  commitsTotal: number;
  commitsWithRefs: number;
  commitsTraced: number;
  commitPercent: number | null;
  commitsWindow: CommitsWindow;
  untracedCommits: UntracedCommits;
}

export interface PendingQueue {
  total: number;
  unassigned: number;
  oldestDays: number | null;
  over7Days: number;
}

export interface SuccessMetrics {
  agentHumanEfficiency: AgentHumanEfficiency;
  systemIntegrity: SystemIntegrity;
  traceability: Traceability;
  pendingQueue: PendingQueue;
  capacities: Capacities;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round((numerator / denominator) * 100, 1);
}

/** Hours between claim and completion, or the first reason (fixed precedence) the order cannot be measured. */
function measureResolution(claimedAt: string | null, completedAt: string | null): { hours: number; claimedAt: string; completedAt: string } | { reason: UnmeasuredReason } {
  if (!claimedAt) return { reason: 'missing_claim' };
  if (!completedAt) return { reason: 'missing_completion' };
  const claimed = Date.parse(claimedAt);
  const completed = Date.parse(completedAt);
  if (Number.isNaN(claimed) || Number.isNaN(completed)) return { reason: 'invalid_timestamp' };
  const hours = (completed - claimed) / MS_PER_HOUR;
  return hours >= 0 ? { hours, claimedAt, completedAt } : { reason: 'negative_duration' };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1] as number;
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}

/** Linear-interpolated percentile (R-7) over an ascending array. */
function percentile(ascending: number[], fraction: number): number {
  const rank = (ascending.length - 1) * fraction;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const low = ascending[lo] as number;
  const high = ascending[hi] as number;
  return low + (high - low) * (rank - lo);
}

function computeSlowest(byHoursDesc: MeasuredOrder[]): AgentHumanEfficiency['slowest'] {
  const total = byHoursDesc.filter((m) => m.hours > SLOW_RESOLUTION_HOURS).length;
  const items = byHoursDesc
    .slice(0, Math.min(total, SLOW_RESOLUTION_ITEMS))
    .map((m) => ({ id: m.id, claimedAt: m.claimedAt, completedAt: m.completedAt, resolutionHours: round(m.hours, 2) }));
  return { thresholdHours: SLOW_RESOLUTION_HOURS, total, items };
}

function computeEfficiency(workOrders: MetricsRaw['workOrders']): AgentHumanEfficiency {
  const completed = workOrders.filter((wo) => COMPLETED_STATUSES.has(wo.status));
  const measured: MeasuredOrder[] = [];
  const unmeasured: UnmeasuredWorkOrder[] = [];
  for (const wo of completed) {
    const result = measureResolution(wo.claimedAt, wo.completedAt);
    if ('hours' in result) measured.push({ id: wo.id, claimedAt: result.claimedAt, completedAt: result.completedAt, hours: result.hours });
    else unmeasured.push({ id: wo.id, status: wo.status, reason: result.reason, claimedAt: wo.claimedAt, completedAt: wo.completedAt });
  }
  const compareId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  unmeasured.sort(compareId);
  const byHoursDesc = [...measured].sort((a, b) => b.hours - a.hours || compareId(a, b));
  const hours = measured.map((m) => m.hours);
  const ascending = [...hours].sort((a, b) => a - b);

  return {
    completedWorkOrders: completed.length,
    measuredWorkOrders: measured.length,
    avgResolutionHours: measured.length === 0 ? null : round(hours.reduce((sum, h) => sum + h, 0) / measured.length, 2),
    medianResolutionHours: measured.length === 0 ? null : round(median(hours), 2),
    p90ResolutionHours: measured.length === 0 ? null : round(percentile(ascending, P90_FRACTION), 2),
    maxResolutionHours: byHoursDesc[0] ? round(byHoursDesc[0].hours, 2) : null,
    slowest: computeSlowest(byHoursDesc),
    unmeasured: { total: unmeasured.length, workOrders: unmeasured },
  };
}

function computePendingQueue(workOrders: MetricsRaw['workOrders']): PendingQueue {
  const pending = workOrders.filter((wo) => wo.status === 'pending');
  const ages = pending.map((wo) => ageDaysFrom(wo.createdAt)).filter((age): age is number => age !== null);

  return {
    total: pending.length,
    unassigned: pending.filter((wo) => (wo.assignedTo ?? '') === '').length,
    oldestDays: ages.length === 0 ? null : Math.max(...ages),
    over7Days: ages.filter((age) => age > STALE_PENDING_DAYS).length,
  };
}

type FeatureTraceability = Pick<Traceability, 'featuresTotal' | 'featuresTraced' | 'orphanFeatures' | 'featurePercent' | 'featuresByKind'>;

/** D3: todo sale de la lista cruda `raw.features`; el denominador es el Feature Tree, el BC sólo viaja en el desglose. */
function computeTraceability(raw: MetricsRaw): FeatureTraceability {
  const isTree = (kind: string): boolean => (FEATURE_TREE_KINDS as readonly string[]).includes(kind);
  const tree = raw.features.filter((f) => isTree(f.kind));
  const orphanFeatures = tree.filter((f) => !f.traced).map((f) => ({ id: f.id, kind: f.kind, title: f.title, status: f.status }));
  const featuresTotal = tree.length;
  const featuresTraced = featuresTotal - orphanFeatures.length;
  const featuresByKind = FEATURE_KIND_ORDER.flatMap((kind) => {
    const ofKind = raw.features.filter((f) => f.kind === kind);
    return ofKind.length === 0 ? [] : [{ kind, total: ofKind.length, traced: ofKind.filter((f) => f.traced).length }];
  });
  return { featuresTotal, featuresTraced, orphanFeatures, featurePercent: percent(featuresTraced, featuresTotal), featuresByKind };
}

/** `untraced` es obligatorio a propósito: un default vacío taparía el bug que esta lista viene a mostrar. */
export function computeMetrics(raw: MetricsRaw, untraced: UntracedCommits, docs: readonly ParsedDoc[] = []): SuccessMetrics {
  return {
    agentHumanEfficiency: computeEfficiency(raw.workOrders),
    systemIntegrity: {
      governedTotal: raw.governedTotal,
      governedSynced: raw.governedSynced,
      syncedPercent: percent(raw.governedSynced, raw.governedTotal),
    },
    traceability: {
      ...computeTraceability(raw),
      commitsTotal: raw.commitsTotal,
      commitsWithRefs: raw.commitsWithRefs,
      commitsTraced: raw.commitsTraced,
      commitPercent: percent(raw.commitsTraced, raw.commitsTotal),
      commitsWindow: { branch: raw.commitsBranch ?? null, sha: raw.commitsSha ?? null, reportedAt: raw.commitsReportedAt ?? null },
      untracedCommits: untraced,
    },
    pendingQueue: computePendingQueue(raw.workOrders),
    capacities: computeCapacities(docs),
  };
}

/**
 * Las superficies de producto (MCP, HTTP del server, CLI) SIEMPRE pasan los documentos del scan para `capacities`;
 * sólo la ruta legacy `/api/metrics` de `packages/web` queda con `[]` (ventanas en cero).
 */
export async function getMetrics(store: Pick<GraphStore, 'metricsRaw' | 'untracedCommits'>, docs: readonly ParsedDoc[] = []): Promise<SuccessMetrics> {
  const [raw, untraced] = await Promise.all([store.metricsRaw(), store.untracedCommits()]);
  return computeMetrics(raw, untraced, docs);
}
