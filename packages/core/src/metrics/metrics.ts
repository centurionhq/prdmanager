import { ageDaysFrom } from '../graph/work-order-age.js';
import type { GraphStore, MetricsRaw, OrphanFeature } from '../graph/types.js';

const COMPLETED_STATUSES = new Set(['done', 'out_of_sync']);
const MS_PER_HOUR = 3_600_000;
const STALE_PENDING_DAYS = 7;

export type UnmeasuredReason = 'missing_claim' | 'missing_completion' | 'invalid_timestamp' | 'negative_duration';

export interface UnmeasuredWorkOrder {
  id: string;
  status: MetricsRaw['workOrders'][number]['status'];
  reason: UnmeasuredReason;
  claimedAt: string | null;
  completedAt: string | null;
}

export interface AgentHumanEfficiency {
  completedWorkOrders: number;
  measuredWorkOrders: number;
  avgResolutionHours: number | null;
  medianResolutionHours: number | null;
  unmeasured: { total: number; workOrders: UnmeasuredWorkOrder[] };
}

export interface SystemIntegrity {
  governedTotal: number;
  governedSynced: number;
  syncedPercent: number | null;
}

export interface Traceability {
  featuresTotal: number;
  featuresTraced: number;
  orphanFeatures: OrphanFeature[];
  featurePercent: number | null;
  commitsTotal: number;
  commitsWithRefs: number;
  commitsTraced: number;
  commitPercent: number | null;
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
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round((numerator / denominator) * 100, 1);
}

/** Hours between claim and completion, or the first reason (fixed precedence) the order cannot be measured. */
function measureResolution(claimedAt: string | null, completedAt: string | null): { hours: number } | { reason: UnmeasuredReason } {
  if (!claimedAt) return { reason: 'missing_claim' };
  if (!completedAt) return { reason: 'missing_completion' };
  const claimed = Date.parse(claimedAt);
  const completed = Date.parse(completedAt);
  if (Number.isNaN(claimed) || Number.isNaN(completed)) return { reason: 'invalid_timestamp' };
  const hours = (completed - claimed) / MS_PER_HOUR;
  return hours >= 0 ? { hours } : { reason: 'negative_duration' };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1] as number;
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}

function computeEfficiency(workOrders: MetricsRaw['workOrders']): AgentHumanEfficiency {
  const completed = workOrders.filter((wo) => COMPLETED_STATUSES.has(wo.status));
  const measured: number[] = [];
  const unmeasured: UnmeasuredWorkOrder[] = [];
  for (const wo of completed) {
    const result = measureResolution(wo.claimedAt, wo.completedAt);
    if ('hours' in result) measured.push(result.hours);
    else unmeasured.push({ id: wo.id, status: wo.status, reason: result.reason, claimedAt: wo.claimedAt, completedAt: wo.completedAt });
  }
  unmeasured.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    completedWorkOrders: completed.length,
    measuredWorkOrders: measured.length,
    avgResolutionHours: measured.length === 0 ? null : round(measured.reduce((sum, h) => sum + h, 0) / measured.length, 2),
    medianResolutionHours: measured.length === 0 ? null : round(median(measured), 2),
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

export function computeMetrics(raw: MetricsRaw): SuccessMetrics {
  return {
    agentHumanEfficiency: computeEfficiency(raw.workOrders),
    systemIntegrity: {
      governedTotal: raw.governedTotal,
      governedSynced: raw.governedSynced,
      syncedPercent: percent(raw.governedSynced, raw.governedTotal),
    },
    traceability: {
      featuresTotal: raw.featuresTotal,
      featuresTraced: raw.featuresTraced,
      orphanFeatures: raw.orphanFeatures,
      featurePercent: percent(raw.featuresTraced, raw.featuresTotal),
      commitsTotal: raw.commitsTotal,
      commitsWithRefs: raw.commitsWithRefs,
      commitsTraced: raw.commitsTraced,
      commitPercent: percent(raw.commitsTraced, raw.commitsTotal),
    },
    pendingQueue: computePendingQueue(raw.workOrders),
  };
}

export async function getMetrics(store: Pick<GraphStore, 'metricsRaw'>): Promise<SuccessMetrics> {
  return computeMetrics(await store.metricsRaw());
}
