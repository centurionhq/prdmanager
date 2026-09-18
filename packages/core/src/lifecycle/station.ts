import type { ParsedDoc } from '../domain/schema.js';

/**
 * The Centurion Factory line board's seven-station pipeline (originally SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-328; renamed and expanded by SDD-024/PRD-011 §4.3 so every station name
 * is understandable without reading this file), hand-synced with `@prdm/contracts`' own `STATIONS` (same
 * "no cross-package dependency" convention already used for `DocumentKind`/`GovernedReason` elsewhere in
 * this codebase).
 */
export const STATIONS = ['entrada', 'caso_negocio', 'producto', 'diseno_tecnico', 'planificacion', 'construccion', 'entregado'] as const;
export type Station = (typeof STATIONS)[number];

export interface FeatureLineProgress {
  done: number;
  total: number;
  stopped: number;
}

export interface FeatureLine {
  id: string;
  kind: 'MRD' | 'PRD' | 'FR' | 'BC';
  title: string;
  status: string;
  station: Station;
  /** The earliest station with an unresolved error-severity issue attributed to this feature (WO-329's
   * `computeAndon`); absent when this feature has none. */
  andonStation?: Station;
  progress: FeatureLineProgress;
  /** WO-443 (SDD-024/PRD-011 §4.4): PRDs whose `justified_by` resolves to this row's BC -- "una fila por
   * iniciativa, anclada en el BC" -- nested here instead of getting a row of their own. Always empty for
   * a row that isn't a BC, and for a BC with no linked PRD yet. */
  children: FeatureLine[];
}

export interface LineBoard {
  features: FeatureLine[];
  /** Never set by {@link deriveLineBoard} itself (always `null`) — computing it requires attributed
   * drift issues, which only `../sync/issue-attribution.js`'s `computeAndon` (WO-329) has. */
  andon: { featureId: string; station: Station } | null;
}

type FeatureDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'MRD' | 'PRD' | 'FR' | 'BC' }> };
/** MRD/PRD/FR share one Zod schema (`type: z.enum([...])`), so `Extract<..., { type: 'PRD' }>` alone
 * resolves to `never` -- the intersection re-narrows the `type` field within that shared shape instead.
 * Covers `'PRD' | 'FR'` (WO-450/SDD-025 widened row-nesting to FR, same as WO-448 widened the lifecycle
 * gate) -- kept named `PrdDoc`/`isPrd` since a PRD is still the common case, not because FR is excluded. */
type PrdDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'MRD' | 'PRD' | 'FR' }> & { type: 'PRD' | 'FR' } };
type BcDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'BC' }> };
type WorkOrderDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'WO' }> };

const isFeature = (d: ParsedDoc): d is FeatureDoc => d.node.label === 'Feature';
const isPrd = (d: ParsedDoc): d is PrdDoc => d.frontmatter.type === 'PRD' || d.frontmatter.type === 'FR';
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

/** WO-443, widened to FR by WO-450: the BC (if any) a PRD/FR's `justified_by` resolves to -- same
 * first-match lookup as `../lifecycle/check.ts`'s own `justifyingBusinessCase`, kept local rather than
 * imported so this module's board-projection concern stays decoupled from that one's lifecycle-gate
 * concern. */
function justifyingBc(prd: PrdDoc, byId: ReadonlyMap<string, ParsedDoc>): BcDoc | null {
  for (const id of prd.frontmatter.justified_by ?? []) {
    const candidate = byId.get(id);
    if (candidate?.frontmatter.type === 'BC') return candidate as BcDoc;
  }
  return null;
}

/** SDD-018 "Archivado de Work Orders": an archived work order is resolved, the same as a done one --
 * `close.ts`'s own `work_orders_done` check already treats them identically (WO-414), so the dashboard
 * must too, or a feature closeable via `closeFeature` could still show as stuck mid-pipeline here. */
const isResolved = (wo: WorkOrderDoc): boolean => wo.frontmatter.status === 'done' || wo.frontmatter.status === 'archived';

function computeProgress(workOrders: readonly WorkOrderDoc[]): FeatureLineProgress {
  return {
    done: workOrders.filter(isResolved).length,
    total: workOrders.length,
    stopped: workOrders.filter((wo) => wo.frontmatter.status === 'out_of_sync').length,
  };
}

/**
 * WO-328, renamed/extended by WO-442 (SDD-024/PRD-011 §4.3): the first rule that applies wins, in this
 * order (PRD-002 §3-adjacent, SDD-012's own station mapping):
 *
 * 1. `entregado` — closed, or every reachable work order is done/archived (and at least one exists;
 *    SDD-018: archived counts as resolved, same as done).
 * 2. `construccion` — some reachable work order is in_progress, out_of_sync, done or archived (not all
 *    done/archived, or rule 1 would already have matched).
 * 3. `planificacion` — has reachable work orders and every one is still pending.
 * 4. `diseno_tecnico` — approved, or some blueprint architects it (with no work orders yet).
 * 5. `caso_negocio`/`producto` — justified (see {@link isJustified}): a `BC` sits at `caso_negocio`
 *    ("hay un BC escrito"), any other Feature kind sits at `producto`. The stricter rule that a `PRD`
 *    specifically needs an *approved* `BC` (not just any justification) is `checkFeatureBusinessCase`'s job
 *    (`../lifecycle/check.ts`), not the board's — this is board *placement*, not the lifecycle gate.
 * 6. `entrada` — none of the above.
 */
function deriveStation(doc: FeatureDoc, docs: readonly ParsedDoc[]): { station: Station; progress: FeatureLineProgress } {
  const workOrders = reachableWorkOrders(docs, doc.node.id);
  const progress = computeProgress(workOrders);

  if (doc.node.status === 'closed' || (progress.total > 0 && progress.done === progress.total)) return { station: 'entregado', progress };
  if (workOrders.some((wo) => wo.frontmatter.status === 'in_progress' || wo.frontmatter.status === 'out_of_sync' || isResolved(wo))) {
    return { station: 'construccion', progress };
  }
  if (progress.total > 0 && workOrders.every((wo) => wo.frontmatter.status === 'pending')) return { station: 'planificacion', progress };
  if (doc.node.status === 'approved' || architectingBlueprints(docs, doc.node.id).length > 0) return { station: 'diseno_tecnico', progress };
  if (isJustified(doc, docs)) return { station: doc.frontmatter.type === 'BC' ? 'caso_negocio' : 'producto', progress };
  return { station: 'entrada', progress };
}

/**
 * WO-443 (SDD-024/PRD-011 §4.4), widened to FR by WO-450 (SDD-025): a BC row's station/progress
 * traverses its linked PRD(s)/FR(s), not just the BC document itself -- `BC <- JUSTIFIED_BY <- (PRD|FR)
 * -> ARCHITECTS <- blueprint -> IMPLEMENTS <- WO`, reusing `architectingBlueprints`/`workOrdersImplementing`
 * (via `reachableWorkOrders`) exactly like {@link deriveStation} does for a single document; no new graph
 * traversal. First rule that applies wins:
 *
 * 1. `entregado` — the BC itself is closed, or every WO reachable via any linked PRD/FR is done/archived
 *    (and at least one exists).
 * 2. `construccion` — some WO reachable via a linked PRD/FR is in_progress, out_of_sync, done or archived.
 * 3. `planificacion` — has reachable WOs (via a linked PRD/FR) and every one is still pending.
 * 4. `diseno_tecnico` — some linked PRD/FR has a blueprint architecting it.
 * 5. `producto` — some linked PRD/FR is approved ("hay un PRD colgado del BC y aprobado" -- PRD-011's own
 *    table keeps this distinct from `diseno_tecnico`, unlike a standalone PRD/FR's {@link deriveStation}
 *    where "approved" and "architected" collapse into the same station).
 * 6. `caso_negocio` — the BC itself is approved or justified (see {@link isJustified}): "hay un BC
 *    escrito". Deliberately does *not* fall through to `diseno_tecnico` just because the BC itself is
 *    `approved` (unlike a standalone Feature's {@link deriveStation}) -- PRD-011 §4.4's own acceptance
 *    criterion is explicit that "un BC aprobado sin PRD todavía... [queda] parado en Caso de negocio".
 * 7. `entrada` — none of the above.
 */
function deriveBcRowStation(bc: BcDoc, prds: readonly PrdDoc[], docs: readonly ParsedDoc[]): { station: Station; progress: FeatureLineProgress } {
  const workOrders = prds.flatMap((prd) => reachableWorkOrders(docs, prd.node.id));
  const progress = computeProgress(workOrders);

  if (bc.node.status === 'closed' || (progress.total > 0 && progress.done === progress.total)) return { station: 'entregado', progress };
  if (workOrders.some((wo) => wo.frontmatter.status === 'in_progress' || wo.frontmatter.status === 'out_of_sync' || isResolved(wo))) {
    return { station: 'construccion', progress };
  }
  if (progress.total > 0 && workOrders.every((wo) => wo.frontmatter.status === 'pending')) return { station: 'planificacion', progress };
  if (prds.some((prd) => architectingBlueprints(docs, prd.node.id).length > 0)) return { station: 'diseno_tecnico', progress };
  if (prds.some((prd) => prd.node.status === 'approved')) return { station: 'producto', progress };
  if (bc.node.status === 'approved' || isJustified(bc, docs)) return { station: 'caso_negocio', progress };
  return { station: 'entrada', progress };
}

function toChildLine(prd: PrdDoc, docs: readonly ParsedDoc[]): FeatureLine {
  const { station, progress } = deriveStation(prd, docs);
  return { id: prd.node.id, kind: prd.frontmatter.type, title: prd.node.title, status: prd.node.status, station, progress, children: [] };
}

/** Pure: places every Feature (MRD/PRD/FR/BC) on its current station, one row per initiative. Never
 * computes the andon signal -- see {@link LineBoard.andon}'s own doc comment.
 *
 * WO-443's row collapsing (SDD-024/PRD-011 §4.4), widened to FR by WO-450 (SDD-025): a PRD or FR whose
 * `justified_by` resolves to a BC present in `docs` doesn't get a row of its own -- it nests under that
 * BC's row via {@link FeatureLine.children}. A legacy PRD/FR with no BC link keeps its own row and its
 * own {@link deriveStation}-derived progress, unchanged from before this WO. No document ever appears
 * twice.
 */
export function deriveLineBoard(docs: readonly ParsedDoc[]): LineBoard {
  const byId = new Map(docs.map((d) => [d.node.id, d]));
  const featureDocs = docs.filter(isFeature);
  const prdDocs = featureDocs.filter(isPrd);
  const prdsByBcId = new Map<string, PrdDoc[]>();
  for (const prd of prdDocs) {
    const bc = justifyingBc(prd, byId);
    if (!bc) continue;
    prdsByBcId.set(bc.node.id, [...(prdsByBcId.get(bc.node.id) ?? []), prd]);
  }

  const features = featureDocs
    .filter((doc) => !(isPrd(doc) && justifyingBc(doc, byId) !== null))
    .map((doc): FeatureLine => {
      if (doc.frontmatter.type !== 'BC') {
        const { station, progress } = deriveStation(doc, docs);
        return { id: doc.node.id, kind: doc.frontmatter.type, title: doc.node.title, status: doc.node.status, station, progress, children: [] };
      }
      // `doc.frontmatter.type !== 'BC'` above narrows the accessed expression, not `doc` itself (`BC`
      // shares `FeatureDoc`'s frontmatter union with MRD/PRD/FR) -- same explicit-cast convention as
      // `../lifecycle/check.ts`'s own `checkDoc` switch.
      const bc = doc as BcDoc;
      const linkedPrds = prdsByBcId.get(bc.node.id) ?? [];
      const { station, progress } = deriveBcRowStation(bc, linkedPrds, docs);
      const children = linkedPrds.map((prd) => toChildLine(prd, docs));
      return { id: bc.node.id, kind: bc.frontmatter.type, title: bc.node.title, status: bc.node.status, station, progress, children };
    });
  return { features, andon: null };
}
