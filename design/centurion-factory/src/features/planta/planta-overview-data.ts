/** Data selection for the Planta KPI strip and the "Drift reciente" / "Órdenes en curso" preview lists (WO-282). */
import { DRIFT_ISSUES, METRICS, WORK_ORDERS } from '../../data';
import type { DriftIssue, Metrics, UntracedCommit, WorkOrder } from '../../data';
import { formatMedianResolution, formatPercent } from './planta-format';

import { formatDateTimeEs } from '../../lib/format-date';

/** WO-669 (SDD-080 D6): what a commit KPI's drawer shows. The copy is the app's own, word for word. */
export interface PlantaKpiDetail {
  readonly kind: 'with_refs' | 'traced';
  readonly definition: string;
  readonly count: string;
  readonly dangling: string | null;
  readonly rows: readonly { readonly sha: string; readonly subject: string; readonly author: string; readonly date: string; readonly files: number; readonly gap: UntracedCommit['gap'] }[];
  readonly truncatedCopy: string | null;
}

export interface PlantaKpi {
  readonly label: string;
  readonly value: string;
  /** Secondary line under the value (commit KPIs only). */
  readonly percent?: string;
  readonly detail?: PlantaKpiDetail;
}

const SHORT_SHA_LENGTH = 7;

const DEFINITIONS = {
  with_refs: 'Commits cuyo mensaje lleva el trailer Refs:; la lista son los que no lo llevan.',
  traced: 'Commits cuya ref resuelve la cadena hasta una feature (WO → Blueprint → Feature); la lista son los que no la resuelven.',
} as const;

function buildDetail(kind: PlantaKpiDetail['kind'], traceability: Metrics['traceability']): PlantaKpiDetail | undefined {
  const { commitsTotal, untracedCommits: untraced } = traceability;
  const missingRefs = untraced.total - untraced.danglingRefs;
  if (commitsTotal === 0 || (kind === 'with_refs' ? missingRefs <= 0 : untraced.total <= 0)) return undefined;
  const items = kind === 'with_refs' ? untraced.items.filter((item) => item.gap === 'no_refs') : untraced.items;
  return {
    kind,
    definition: DEFINITIONS[kind],
    count: kind === 'with_refs' ? `${missingRefs} de ${commitsTotal} commits sin el trailer Refs:` : `${untraced.total} de ${commitsTotal} commits sin trazar`,
    dangling: kind === 'traced' ? `${untraced.danglingRefs} ${untraced.danglingRefs === 1 ? 'ref colgante' : 'refs colgantes'}` : null,
    rows: items.map((item) => ({
      sha: item.sha.slice(0, SHORT_SHA_LENGTH),
      subject: item.subject,
      author: item.author,
      date: formatDateTimeEs(item.date),
      files: item.files.length,
      gap: item.gap,
    })),
    truncatedCopy: untraced.truncated ? `Se muestran los primeros ${untraced.items.length} de ${untraced.total}.` : null,
  };
}

function commitKpi(label: string, kind: PlantaKpiDetail['kind'], count: number, percent: string, traceability: Metrics['traceability']): PlantaKpi {
  if (traceability.commitsTotal === 0) return { label, value: 'Sin datos' };
  const detail = buildDetail(kind, traceability);
  return { label, value: `${count}/${traceability.commitsTotal}`, percent, ...(detail ? { detail } : {}) };
}

/**
 * Mirrors core's `percent()` (and the app's own helper): no commits means "Sin datos", never a
 * fabricated 0 % — and never the *other* commit field's number, which is what WO-648 fixed here.
 */
function formatCommitRefsPercent(traceability: Metrics['traceability']): string {
  return traceability.commitsTotal === 0 ? 'Sin datos' : formatPercent((traceability.commitsWithRefs / traceability.commitsTotal) * 100);
}

/** The 5 KPIs, left→right in product order (WO-648): the two commit KPIs stay adjacent, refs last. */
export function buildKpis(metrics = METRICS): readonly PlantaKpi[] {
  return [
    { label: 'Resolución mediana de una orden', value: formatMedianResolution(metrics.agentHumanEfficiency.medianResolutionHours) },
    { label: 'Código sincronizado', value: formatPercent(metrics.systemIntegrity.syncedPercent) },
    { label: 'Features trazadas', value: formatPercent(metrics.traceability.featurePercent) },
    commitKpi('Commits trazados', 'traced', metrics.traceability.commitsTraced, formatPercent(metrics.traceability.commitPercent), metrics.traceability),
    commitKpi('Commits con Refs', 'with_refs', metrics.traceability.commitsWithRefs, formatCommitRefsPercent(metrics.traceability), metrics.traceability),
  ];
}

const RECENT_DRIFT_COUNT = 3;
const IN_PROGRESS_ORDERS_COUNT = 3;
const IN_PROGRESS_STATUSES = new Set<WorkOrder['status']>(['in_progress', 'out_of_sync']);

/** The 3 most recently detected issues, newest first (ties keep their original data order). */
export function recentDriftIssues(issues: readonly DriftIssue[] = DRIFT_ISSUES): readonly DriftIssue[] {
  return [...issues].sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()).slice(0, RECENT_DRIFT_COUNT);
}

/** in_progress and out_of_sync orders, most recently updated first, capped at 3. */
export function inProgressOrders(orders: readonly WorkOrder[] = WORK_ORDERS): readonly WorkOrder[] {
  return orders
    .filter((order) => IN_PROGRESS_STATUSES.has(order.status))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, IN_PROGRESS_ORDERS_COUNT);
}
