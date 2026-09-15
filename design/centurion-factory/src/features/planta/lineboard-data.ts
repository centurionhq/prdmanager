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

export interface AndonState {
  readonly row: LineRow;
  readonly station: Station;
  readonly stationIndex: number;
}

/** The first stopped row on the board, if any — the line only ever stops in one place. */
export function findAndon(rows: readonly LineRow[]): AndonState | undefined {
  const row = rows.find((candidate) => candidate.kind === 'stopped');
  if (!row) return undefined;
  return { row, station: row.feature.station, stationIndex: stationIndex(row.feature.station) };
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
