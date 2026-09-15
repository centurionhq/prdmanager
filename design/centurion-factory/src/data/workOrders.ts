/**
 * Work order mock data (WO-270): barrel over workOrdersCore.ts (real graph work orders) and
 * workOrdersSample.ts (the FR-002 set plus filler), with lookup helpers.
 */
import type { WorkOrder } from './types';
import { CORE_WORK_ORDERS } from './workOrdersCore';
import { SAMPLE_WORK_ORDERS } from './workOrdersSample';

export const WORK_ORDERS: readonly WorkOrder[] = [...CORE_WORK_ORDERS, ...SAMPLE_WORK_ORDERS];

export function getWorkOrder(id: string): WorkOrder | undefined {
  return WORK_ORDERS.find((wo) => wo.id === id);
}

export function workOrdersForFeature(featureId: string): readonly WorkOrder[] {
  return WORK_ORDERS.filter((wo) => wo.featureId === featureId);
}

export interface WorkOrderProgress {
  readonly done: number;
  readonly total: number;
  readonly stopped: number;
}

/**
 * Some features (PRD-005 alone closed 245 work orders) have far more history than it makes sense
 * to represent as literal mock rows. This table lets `workOrderProgress` report the exact numbers
 * the canvas commits to — FR-002 "14/22 · 3 paradas" and PRD-005 "245/245" — without inflating
 * workOrdersSample.ts with hundreds of placeholder entries. The handful of WorkOrder rows that do
 * exist for these features (see workOrdersForFeature) are a representative sample, not the full set.
 */
export interface FeatureProgressOverride extends WorkOrderProgress {
  readonly featureId: string;
}

export const FEATURE_PROGRESS_OVERRIDES: readonly FeatureProgressOverride[] = [
  { featureId: 'FR-002', done: 14, total: 22, stopped: 3 },
  { featureId: 'PRD-005', done: 245, total: 245, stopped: 0 },
];

export function workOrderProgress(featureId: string): WorkOrderProgress {
  const override = FEATURE_PROGRESS_OVERRIDES.find((o) => o.featureId === featureId);
  if (override) return { done: override.done, total: override.total, stopped: override.stopped };

  const wos = workOrdersForFeature(featureId);
  return {
    done: wos.filter((wo) => wo.status === 'done').length,
    total: wos.length,
    stopped: wos.filter((wo) => wo.status === 'out_of_sync').length,
  };
}
