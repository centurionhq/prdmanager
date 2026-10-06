/**
 * Pure selection and labeling helpers for the LineBoard (WO-280).
 *
 * Row selection deviates slightly from a literal read of canvas/Main.dc.html: that artboard
 * shows 5 rows (FR-002, PRD-006, FR-003, FR-001, PRD-005). The brief asks for "those the canvas
 * shows plus the other sample ones, max 6", so we append the remaining `sample: true` features
 * (FR-004, then FR-005) in their data order and cut the list at 6 rows — which keeps FR-004 and
 * drops FR-005 here. The root MRD and the base PRD-001 are always excluded.
 */
import { FEATURES, STATIONS, STATION_LABELS, workOrderProgress } from '../../data';
import type { Feature, Station, WorkOrderProgress } from '../../data';

export const LINE_BOARD_MAX_ROWS = 6;

const EXCLUDED_FEATURE_IDS = new Set(['MRD-001', 'PRD-001']);

/** Row order on the approved desktop canvas, top to bottom. */
const CANVAS_FEATURE_ORDER = ['FR-002', 'PRD-006', 'FR-003', 'FR-001', 'PRD-005'];

export type LineRowKind = 'closed' | 'draft' | 'stopped' | 'complete' | 'default';

export interface LineRow {
  readonly feature: Feature;
  readonly progress: WorkOrderProgress;
  readonly kind: LineRowKind;
}

/** Picks the canvas rows first, then fills the remaining slots with other sample features. */
export function selectLineFeatures(features: readonly Feature[] = FEATURES): Feature[] {
  const candidates = features.filter((feature) => !EXCLUDED_FEATURE_IDS.has(feature.id));
  const byId = new Map(candidates.map((feature) => [feature.id, feature] as const));

  const canvasFeatures = CANVAS_FEATURE_ORDER.map((id) => byId.get(id)).filter((feature): feature is Feature => Boolean(feature));
  const canvasIds = new Set(canvasFeatures.map((feature) => feature.id));
  const otherSampleFeatures = candidates.filter((feature) => feature.sample && !canvasIds.has(feature.id));

  return [...canvasFeatures, ...otherSampleFeatures].slice(0, LINE_BOARD_MAX_ROWS);
}

function rowKind(feature: Feature, progress: WorkOrderProgress): LineRowKind {
  if (feature.status === 'closed') return 'closed';
  if (feature.status === 'draft') return 'draft';
  if (progress.stopped > 0) return 'stopped';
  if (progress.total > 0 && progress.done === progress.total) return 'complete';
  return 'default';
}

export function buildLineRows(features: readonly Feature[] = selectLineFeatures()): LineRow[] {
  return features.map((feature) => {
    const progress = workOrderProgress(feature.id);
    return { feature, progress, kind: rowKind(feature, progress) };
  });
}

export function stationIndex(station: Station): number {
  return STATIONS.indexOf(station);
}

/** WO-680 (SDD-084 D1): every stopped row, ordered by station (earliest first) — the same criterion the
 * board used to pick its single andon, now applied to the whole list the notice renders. */
export function findStopped(rows: readonly LineRow[]): LineRow[] {
  return rows
    .filter((row) => row.kind === 'stopped')
    .sort((a, b) => stationIndex(a.feature.station) - stationIndex(b.feature.station));
}

export function rowLabel(row: LineRow): string {
  const { progress, kind } = row;
  switch (kind) {
    case 'closed':
      return `cerrada · ${progress.done}/${progress.total}`;
    case 'draft':
      return 'borrador';
    case 'stopped':
      return `${progress.done}/${progress.total} · ${progress.stopped} paradas`;
    case 'complete':
      return `${progress.done}/${progress.total} · falta reconocer`;
    default:
      return progress.total > 0 ? `${progress.done}/${progress.total}` : 'sin órdenes activas';
  }
}

export function rowAccessibleName(row: LineRow): string {
  const { feature, progress, kind } = row;
  const base = `${feature.id} ${feature.title}, estación ${STATION_LABELS[feature.station]}`;
  const progressPart = progress.total > 0 ? `, ${progress.done} de ${progress.total} órdenes hechas` : '';
  const stoppedPart = kind === 'stopped' ? `, línea detenida: ${progress.stopped} órdenes fuera de sincronía` : '';
  return `${base}${progressPart}${stoppedPart}`;
}

/** WO-681: the drawer's header, from the row's own progress (e.g. «22 órdenes · 14 hechas · 3 paradas»). */
export function ordersSummary(progress: WorkOrderProgress): string {
  const { done, total, stopped } = progress;
  if (total === 0) return 'Sin órdenes activas';
  return `${total} ${total === 1 ? 'orden' : 'órdenes'} · ${done} ${done === 1 ? 'hecha' : 'hechas'} · ${stopped} ${stopped === 1 ? 'parada' : 'paradas'}`;
}
