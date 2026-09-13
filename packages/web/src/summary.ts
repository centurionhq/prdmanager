import { DOC_KINDS, scanDocuments, type DocKind, type Engine, type FolderMap, type PrdmConfig } from '@prdm/core';

/**
 * One short sentence per document kind summarizing its PRD-002 §3 lifecycle gate, mirrored from
 * `packages/mcp/src/tools-authoring.ts` (`LIFECYCLE_RULES`). Not imported from `@prdm/mcp`: `web` depends only on
 * `@prdm/core` (SDD-005 "Arquitectura" — a single direction, `web -> @prdm/core`), and `@prdm/mcp`'s copy also
 * doubles as authoring guidance this read-only explorer has no use for.
 */
const LIFECYCLE_RULES: Readonly<Record<DocKind, string>> = {
  MRD: 'needs a "justified_by" link to an existing Feedback/Artifact (or one of those linking back via informs/provides_context_for)',
  PRD: 'needs a "justified_by" link to an existing Feedback/Artifact (or one of those linking back via informs/provides_context_for)',
  FR: 'needs a "justified_by" link to an existing Feedback/Artifact (or one of those linking back via informs/provides_context_for)',
  SDD: 'needs non-empty "impacts_paths" and a "## Tareas"/"## Tasks" checklist with at least one item before work orders can be generated',
  ADR: 'needs non-empty "impacts_paths" and a "## Tareas"/"## Tasks" checklist with at least one item before work orders can be generated',
  WO: 'generated only by generate_work_orders from a blueprint checklist; never drafted or committed directly',
  FB: 'needs "informs" (or root: true) to justify a feature; a "new" one with neither is only a warning',
  ART: 'needs "provides_context_for" (or root: true) to justify a feature',
};

/**
 * `GET /api/project` response (SDD-005 "Contrato HTTP"). Deliberately narrower than `@prdm/mcp`'s
 * `ProjectSummary`: no `openDrafts`/`draftableKinds` — this package has no authoring surface, and reporting
 * "0 drafts" here would be a lie rather than a fact.
 */
export interface WebProjectSummary {
  id: string;
  name: string;
  folders: FolderMap;
  lifecycle: Readonly<Record<DocKind, string>>;
  counts: Record<DocKind, number>;
}

/** Narrower than the full app dependency bag: this summary never touches Neo4j, so it needs no `GraphStore`. */
export interface SummaryDeps {
  config: PrdmConfig;
  engine: Engine;
}

/** Builds the `/api/project` payload straight from the repo's documents; never calls `engine.refresh()`/`recover()` (SDD-005 "Ciclo de vida del Engine" — this process is strictly read-only). */
export async function buildWebProjectSummary(deps: SummaryDeps): Promise<WebProjectSummary> {
  const { config } = deps;
  const { docs } = await scanDocuments(config.root, config.ignore);
  const counts = Object.fromEntries(DOC_KINDS.map((kind) => [kind, 0])) as Record<DocKind, number>;
  for (const doc of docs) counts[doc.node.kind] += 1;
  return {
    id: config.project.id,
    name: config.project.name,
    folders: config.folders,
    lifecycle: LIFECYCLE_RULES,
    counts,
  };
}
