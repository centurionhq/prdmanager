/**
 * Traceability chain math for the Árbol de features detail panel (WO-284): how many work orders,
 * commits and synced code references trace back to a feature, plus its recent work order history.
 * Pure and free of React so the numbers are unit-testable on their own.
 */
import { COMMITS, WORK_ORDERS, codeRefsForBlueprint, workOrderProgress, workOrdersForFeature, type Feature, type WorkOrder } from '../../data';

/** `28/08/2026`, the date format the canvas uses everywhere outside relative timestamps. */
export { formatDateEs } from '../../lib/format-date';

export interface TraceabilityChain {
  readonly origin: readonly string[];
  readonly blueprintIds: readonly string[];
  readonly ordersDone: number;
  readonly ordersLabel: string;
  readonly commitsWithRefs: number;
  readonly commitsLabel: string;
  readonly codeSynced: number;
  readonly codeOutOfSync: number;
  readonly codeLabel: string;
  readonly codeInSync: boolean;
  readonly primaryBlueprintId: string | undefined;
}

interface TraceabilityOverride {
  readonly featureId: string;
  readonly ordersDone: number;
  readonly commitsWithRefs: number;
  readonly codeSynced: number;
  readonly codeOutOfSync: number;
}

/**
 * PRD-004 has only 3 representative work orders in the mock data (see workOrdersCore.ts), far
 * short of canvas/Arbol.dc.html's "37 hechas" / "41 con Refs" / "212 referencias sincronizadas".
 * This override reproduces those exact canvas numbers for PRD-004 specifically; every other
 * feature's numbers are computed live from the mock data (using the FEATURE_PROGRESS_OVERRIDES
 * that workOrderProgress already applies for FR-002 and PRD-005).
 */
const OVERRIDES: readonly TraceabilityOverride[] = [{ featureId: 'PRD-004', ordersDone: 37, commitsWithRefs: 41, codeSynced: 212, codeOutOfSync: 0 }];

function computeCommitsWithRefs(featureId: string): number {
  const workOrderIds = new Set(workOrdersForFeature(featureId).map((wo) => wo.id));
  return COMMITS.filter((commit) => commit.refs.some((ref) => workOrderIds.has(ref))).length;
}

function computeCodeCounts(blueprintIds: readonly string[]): { readonly synced: number; readonly outOfSync: number } {
  const refs = blueprintIds.flatMap((id) => codeRefsForBlueprint(id));
  return {
    synced: refs.filter((ref) => ref.status === 'synced').length,
    outOfSync: refs.filter((ref) => ref.status === 'out_of_sync').length,
  };
}

/** Builds the "Origen / Feature / Blueprints / Órdenes / Commits / Código" chain for one feature. */
export function traceabilityFor(feature: Feature): TraceabilityChain {
  const override = OVERRIDES.find((entry) => entry.featureId === feature.id);
  const ordersDone = override?.ordersDone ?? workOrderProgress(feature.id).done;
  const commitsWithRefs = override?.commitsWithRefs ?? computeCommitsWithRefs(feature.id);
  const codeCounts = override
    ? { synced: override.codeSynced, outOfSync: override.codeOutOfSync }
    : computeCodeCounts(feature.blueprintIds);
  const codeInSync = codeCounts.outOfSync === 0;

  return {
    origin: feature.justifiedBy,
    blueprintIds: feature.blueprintIds,
    ordersDone,
    ordersLabel: `${ordersDone} hechas`,
    commitsWithRefs,
    commitsLabel: `${commitsWithRefs} con Refs`,
    codeSynced: codeCounts.synced,
    codeOutOfSync: codeCounts.outOfSync,
    codeLabel: codeInSync ? `${codeCounts.synced} referencias sincronizadas` : `${codeCounts.outOfSync} fuera de sincronía`,
    codeInSync,
    primaryBlueprintId: feature.blueprintIds[0],
  };
}

/** The `limit` most recently updated work orders governed by `blueprintId`, most recent first. */
export function recentOrdersForBlueprint(blueprintId: string, limit = 5): readonly WorkOrder[] {
  return [...WORK_ORDERS]
    .filter((wo) => wo.blueprintId === blueprintId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}
