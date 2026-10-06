import { ageDaysFrom } from '../graph/work-order-age.js';
import type { GraphStore, MetricsRaw } from '../graph/types.js';

const COMPLETED_STATUSES = new Set(['done', 'out_of_sync']);
const MS_PER_HOUR = 3_600_000;
const STALE_PENDING_DAYS = 7;

export interface AgentHumanEfficiency {
  completedWorkOrders: number;
  measuredWorkOrders: number;
  avgResolutionHours: number | null;
  medianResolutionHours: number | null;
}

export interface SystemIntegrity {
  governedTotal: number;
  governedSynced: number;
  syncedPercent: number | null;
}

export interface Traceability {
  featuresTotal: number;
  featuresTraced: number;
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

/** Hours between claim and completion, or null when either timestamp is missing/invalid/non-positive. */
function resolutionHours(claimedAt: string | null, completedAt: string | null): number | null {
  if (!claimedAt || !completedAt) return null;
  const claimed = Date.parse(claimedAt);
  const completed = Date.parse(completedAt);
  if (Number.isNaN(claimed) || Number.isNaN(completed)) return null;
  const hours = (completed - claimed) / MS_PER_HOUR;
  return hours >= 0 ? hours : null;
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
  const measured = completed
    .map((wo) => resolutionHours(wo.claimedAt, wo.completedAt))
    .filter((hours): hours is number => hours !== null);

  return {
    completedWorkOrders: completed.length,
    measuredWorkOrders: measured.length,
    avgResolutionHours: measured.length === 0 ? null : round(measured.reduce((sum, h) => sum + h, 0) / measured.length, 2),
    medianResolutionHours: measured.length === 0 ? null : round(median(measured), 2),
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
