import type { ParsedDoc } from '../domain/schema.js';

/**
 * The Centurion Factory line board's six-station pipeline (SDD-012 "Centurion Factory conectado al
 * backend SaaS", WO-328), hand-synced with `@prdm/contracts`' own `STATIONS` (same "no cross-package
 * dependency" convention already used for `DocumentKind`/`GovernedReason` elsewhere in this codebase).
 */
export const STATIONS = ['ingesta', 'definicion', 'diseno', 'planificacion', 'ejecucion', 'cierre'] as const;
export type Station = (typeof STATIONS)[number];

export interface FeatureLineProgress {
  done: number;
  total: number;
  stopped: number;
}

export interface FeatureLine {
  id: string;
  kind: 'MRD' | 'PRD' | 'FR';
  title: string;
  status: string;
  station: Station;
  /** The earliest station with an unresolved error-severity issue attributed to this feature (WO-329's
   * `computeAndon`); absent when this feature has none. */
  andonStation?: Station;
  progress: FeatureLineProgress;
}

export interface LineBoard {
  features: FeatureLine[];
  /** Never set by {@link deriveLineBoard} itself (always `null`) — computing it requires attributed
   * drift issues, which only `../sync/issue-attribution.js`'s `computeAndon` (WO-329) has. */
  andon: { featureId: string; station: Station } | null;
}

type FeatureDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'MRD' | 'PRD' | 'FR' }> };
type WorkOrderDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'WO' }> };

const isFeature = (d: ParsedDoc): d is FeatureDoc => d.node.label === 'Feature';
const isWorkOrder = (d: ParsedDoc): d is WorkOrderDoc => d.node.label === 'WorkOrder';

/** Same traversal as `close.ts`'s own `architectingBlueprints`. */
function architectingBlueprints(docs: readonly ParsedDoc[], featureId: string): ParsedDoc[] {
  return docs.filter((d) => d.node.label === 'Blueprint' && d.edges.some((e) => e.type === 'ARCHITECTS' && e.to === featureId));
}

/** Same traversal as `close.ts`'s own `workOrdersImplementing`. */
function workOrdersImplementing(docs: readonly ParsedDoc[], blueprintId: string): WorkOrderDoc[] {
  return docs.filter(isWorkOrder).filter((d) => d.edges.some((e) => e.type === 'IMPLEMENTS' && e.to === blueprintId));
}

/** Every work order reachable from `featureId` via ARCHITECTS -> IMPLEMENTS (WO-328's "alcanzable vía blueprints"). */
function reachableWorkOrders(docs: readonly ParsedDoc[], featureId: string): WorkOrderDoc[] {
  return architectingBlueprints(docs, featureId).flatMap((bp) => workOrdersImplementing(docs, bp.node.id));
}

/** Same justification rule as `../lifecycle/check.ts`'s own `hasJustification`. */
function isJustified(doc: FeatureDoc, docs: readonly ParsedDoc[]): boolean {
  if ((doc.frontmatter.justified_by ?? []).length > 0) return true;
  return docs.some((d) => {
    if (d.frontmatter.type === 'FB') return d.frontmatter.informs.includes(doc.node.id);
    if (d.frontmatter.type === 'ART') return d.frontmatter.provides_context_for.includes(doc.node.id);
    return false;
  });
}

function computeProgress(workOrders: readonly WorkOrderDoc[]): FeatureLineProgress {
  return {
    done: workOrders.filter((wo) => wo.frontmatter.status === 'done').length,
    total: workOrders.length,
    stopped: workOrders.filter((wo) => wo.frontmatter.status === 'out_of_sync').length,
  };
}

/**
 * WO-328: the first rule that applies wins, in this order (PRD-002 §3-adjacent, SDD-012's own station
 * mapping):
 *
 * 1. `cierre` — closed, or every reachable work order is done (and at least one exists).
 * 2. `ejecucion` — some reachable work order is in_progress, done or out_of_sync (not all done, or
 *    rule 1 would already have matched).
 * 3. `planificacion` — has reachable work orders and every one is still pending.
 * 4. `diseno` — approved, or some blueprint architects it (with no work orders yet).
 * 5. `definicion` — justified (see {@link isJustified}).
 * 6. `ingesta` — none of the above.
 */
function deriveStation(doc: FeatureDoc, docs: readonly ParsedDoc[]): { station: Station; progress: FeatureLineProgress } {
  const workOrders = reachableWorkOrders(docs, doc.node.id);
  const progress = computeProgress(workOrders);

  if (doc.node.status === 'closed' || (progress.total > 0 && progress.done === progress.total)) return { station: 'cierre', progress };
  if (workOrders.some((wo) => wo.frontmatter.status === 'in_progress' || wo.frontmatter.status === 'done' || wo.frontmatter.status === 'out_of_sync')) {
    return { station: 'ejecucion', progress };
  }
  if (progress.total > 0 && workOrders.every((wo) => wo.frontmatter.status === 'pending')) return { station: 'planificacion', progress };
  if (doc.node.status === 'approved' || architectingBlueprints(docs, doc.node.id).length > 0) return { station: 'diseno', progress };
  if (isJustified(doc, docs)) return { station: 'definicion', progress };
  return { station: 'ingesta', progress };
}

/** Pure: places every Feature (MRD/PRD/FR) on its current station. Never computes the andon signal —
 * see {@link LineBoard.andon}'s own doc comment. */
export function deriveLineBoard(docs: readonly ParsedDoc[]): LineBoard {
  const features = docs.filter(isFeature).map((doc): FeatureLine => {
    const { station, progress } = deriveStation(doc, docs);
    return { id: doc.node.id, kind: doc.frontmatter.type, title: doc.node.title, status: doc.node.status, station, progress };
  });
  return { features, andon: null };
}
