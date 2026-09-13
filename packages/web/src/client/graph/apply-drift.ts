import type { RefreshReport } from '@prdm/core';
import type { EdgeDefinition, NodeDefinition } from 'cytoscape';

type GraphElement = NodeDefinition | EdgeDefinition;

/** Every id `applyDrift` should badge: a live `DriftIssue.nodeId`, or a governed code ref's own file path. */
function collectDriftIds(report: RefreshReport): Set<string> {
  const ids = new Set<string>();
  for (const issue of report.issues) ids.add(issue.nodeId);
  for (const governed of report.governed) ids.add(governed.path);
  return ids;
}

/**
 * `applyDrift(elements, report) -> elements'` (SDD-005 "Frontend" `graph/apply-drift.ts`): the only source of the
 * drift badge on the canvas. Pure — returns a new array, never mutates `elements` or their `data` objects, so it
 * composes cleanly with `useCytoscape`'s `cy.json({elements})` refresh. An element whose `data.id` isn't in
 * `report.issues[].nodeId` or `report.governed[].path` is returned unchanged (same reference).
 */
export function applyDrift<T extends GraphElement>(elements: T[], report: RefreshReport): T[] {
  const driftIds = collectDriftIds(report);
  return elements.map((element) => {
    const { id } = element.data;
    if (id === undefined || !driftIds.has(id)) return element;
    return { ...element, data: { ...element.data, drift: true } };
  });
}
