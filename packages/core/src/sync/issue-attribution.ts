import type { ParsedDoc } from '../domain/schema.js';
import type { FeatureLine, LineBoard, Station } from '../lifecycle/station.js';
import { STATIONS } from '../lifecycle/station.js';
import type { DriftIssue } from './monitor.js';

export interface IssueAttribution {
  featureIds: string[];
  blueprintId: string | null;
  station: Station | null;
}

function featuresArchitectedBy(docs: readonly ParsedDoc[], blueprintId: string): string[] {
  const blueprint = docs.find((d) => d.node.id === blueprintId && d.node.label === 'Blueprint');
  return blueprint ? blueprint.edges.filter((e) => e.type === 'ARCHITECTS').map((e) => e.to) : [];
}

function featuresInformedBy(doc: ParsedDoc): string[] {
  if (doc.frontmatter.type === 'FB') return doc.frontmatter.informs;
  if (doc.frontmatter.type === 'ART') return doc.frontmatter.provides_context_for;
  return [];
}

/** Blueprints (of the ones a work order `implements`) that actually resolve to a real Blueprint document. */
function implementedBlueprints(wo: ParsedDoc, byId: Map<string, ParsedDoc>): string[] {
  return wo.frontmatter.type === 'WO' ? wo.frontmatter.implements.filter((id) => byId.get(id)?.node.label === 'Blueprint') : [];
}

/**
 * Pure: places one `DriftIssue` on the line board (WO-329, SDD-012) — which feature lane(s), which
 * blueprint (if any) and which station it belongs to. An issue kind this function doesn't recognize (or
 * whose target no longer resolves) attributes to nothing (`station: null`), never a guess.
 */
export function attributeIssue(issue: DriftIssue, docs: readonly ParsedDoc[]): IssueAttribution {
  const byId = new Map(docs.map((d) => [d.node.id, d]));
  const target = byId.get(issue.nodeId);

  if ((issue.kind === 'broken_link' || issue.kind === 'invalid_link_target') && target && (target.node.label === 'Feedback' || target.node.label === 'Artifact')) {
    return { featureIds: featuresInformedBy(target), blueprintId: null, station: 'entrada' };
  }

  if (issue.kind === 'feature_changed' || (issue.kind === 'lifecycle_violation' && target?.node.label === 'Feature')) {
    return { featureIds: [issue.nodeId], blueprintId: null, station: 'producto' };
  }

  if (issue.kind === 'blueprint_changed' || issue.kind === 'impacts_warning' || issue.kind === 'awaiting_ci_report') {
    return { featureIds: featuresArchitectedBy(docs, issue.nodeId), blueprintId: issue.nodeId, station: 'diseno_tecnico' };
  }

  if (issue.kind === 'code_out_of_sync') {
    return { featureIds: featuresArchitectedBy(docs, issue.nodeId), blueprintId: issue.nodeId, station: 'construccion' };
  }

  if (issue.kind === 'work_order_out_of_sync') {
    const blueprintIds = target ? implementedBlueprints(target, byId) : [];
    const blueprintId = blueprintIds[0] ?? null;
    const featureIds = [...new Set(blueprintIds.flatMap((id) => featuresArchitectedBy(docs, id)))];
    return { featureIds, blueprintId, station: 'construccion' };
  }

  return { featureIds: [], blueprintId: null, station: null };
}

export interface AttributedIssueLike {
  severity: 'error' | 'warning';
  featureIds: readonly string[];
  station: Station | null;
}

const STATION_ORDER = new Map(STATIONS.map((station, index) => [station, index]));

function earlierStation(a: Station, b: Station): Station {
  return (STATION_ORDER.get(a) ?? 0) <= (STATION_ORDER.get(b) ?? 0) ? a : b;
}

/**
 * Pure: given every attributed issue and the already-derived {@link LineBoard}, computes the andon
 * signal (WO-329, SDD-012) — per feature, the earliest station with at least one unresolved
 * error-severity issue attributed to it, and the project-wide andon as the earliest across every
 * feature. Never mutates `board`; returns a new one with `andonStation`/`andon` filled in.
 *
 * WO-444/SDD-024: a nested PRD (WO-443's row collapsing) has no row of its own in `board.features`, so
 * `andonStation` is annotated recursively into {@link FeatureLine.children} too -- otherwise an issue
 * attributed to a PRD nested under a BC would silently stop lighting up the andon anywhere on the board.
 * The project-wide `andon` itself already worked correctly for nested ids before this WO: it's derived
 * straight from `issues`, never from `board`'s shape.
 */
export function computeAndon(issues: readonly AttributedIssueLike[], board: LineBoard): LineBoard {
  const earliestByFeature = new Map<string, Station>();
  for (const issue of issues) {
    if (issue.severity !== 'error' || issue.station === null) continue;
    for (const featureId of issue.featureIds) {
      const current = earliestByFeature.get(featureId);
      earliestByFeature.set(featureId, current === undefined ? issue.station : earlierStation(current, issue.station));
    }
  }

  const withAndon = (line: FeatureLine): FeatureLine => {
    const children = line.children.map(withAndon);
    const andonStation = earliestByFeature.get(line.id);
    return andonStation === undefined ? { ...line, children } : { ...line, andonStation, children };
  };
  const features = board.features.map(withAndon);

  let andon: LineBoard['andon'] = null;
  for (const [featureId, station] of earliestByFeature) {
    if (andon === null || (STATION_ORDER.get(station) ?? 0) < (STATION_ORDER.get(andon.station) ?? 0)) {
      andon = { featureId, station };
    }
  }

  return { features, andon };
}
