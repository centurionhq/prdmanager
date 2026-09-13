import type { ParsedDoc } from '../domain/schema.js';
import type { GrandfatheredDoc } from '../project/types.js';
import type { DriftIssue } from '../sync/monitor.js';

export interface LifecycleContext {
  /** Pre-PRD-002 documents exempt while their content hash is unchanged (ADR-002 D13). */
  grandfathered: readonly GrandfatheredDoc[];
}

/**
 * Pure lifecycle invariants of PRD-002 §3 (SDD-002 "Ciclo de vida") over a project's documents.
 * Contract for WO-013 (draft validation), WO-019 (implementation) and refresh; issues use kind `lifecycle_violation`.
 */
export function checkLifecycle(_docs: readonly ParsedDoc[], _ctx: LifecycleContext): DriftIssue[] {
  return [];
}
