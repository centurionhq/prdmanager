/** Data selection for the Planta KPI strip and the "Drift reciente" / "Órdenes en curso" preview lists (WO-282). */
import { DRIFT_ISSUES, METRICS, WORK_ORDERS } from '../../data';
import type { DriftIssue, Metrics, WorkOrder } from '../../data';
import { formatMedianResolution, formatPercent } from './planta-format';

export interface PlantaKpi {
  readonly label: string;
  readonly value: string;
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
    { label: 'Commits trazados', value: formatPercent(metrics.traceability.commitPercent) },
    { label: 'Commits con Refs', value: formatCommitRefsPercent(metrics.traceability) },
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
