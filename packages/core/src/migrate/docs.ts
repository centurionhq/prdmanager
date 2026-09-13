import type { Engine, EngineOps, RefreshReport } from '../engine.js';
import { contentHash } from '../parser/frontmatter.js';
import { loadBaseline, saveBaseline, type Baseline } from '../sync/baseline.js';
import type { ParsedDoc } from '../domain/schema.js';

export interface MigrateDocsFieldChange {
  id: string;
  path: string;
  /** e.g. "governs -> impacts_paths" or "status: todo -> pending". */
  changes: string[];
}

export interface MigrateDocsResult {
  dryRun: boolean;
  /** Documents whose deprecated aliases were (or, on a dry run, would be) rewritten. */
  fieldChanges: MigrateDocsFieldChange[];
  /** Blueprints whose baseline hash was re-pointed at the `## Tareas`-excluded hash (ADR-002 D9). */
  rebaselinedBlueprints: string[];
  /** Work orders whose `blueprint_hashes` were advanced to match a rebaselined blueprint. */
  rebaselinedWorkOrders: string[];
  /** Present only when `dryRun` is false: the refresh that ran after writing. */
  report?: RefreshReport;
}

type BlueprintDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'SDD' | 'ADR' }> };
const isBlueprint = (d: ParsedDoc): d is BlueprintDoc => d.frontmatter.type === 'SDD' || d.frontmatter.type === 'ADR';

const GOVERNS_CHANGE = 'governs -> impacts_paths';
const STATUS_CHANGE = 'status: todo -> pending';

function planFieldChanges(docs: ParsedDoc[]): MigrateDocsFieldChange[] {
  return docs.flatMap((d): MigrateDocsFieldChange[] => {
    const changes: string[] = [];
    if (d.deprecations.some((dep) => dep.field === 'governs')) changes.push(GOVERNS_CHANGE);
    if (d.deprecations.some((dep) => dep.field === 'status: todo')) changes.push(STATUS_CHANGE);
    return changes.length === 0 ? [] : [{ id: d.node.id, path: d.node.sourcePath, changes }];
  });
}

/** Blueprints whose *current* content hashes identically to the baseline under the pre-D9 (tasks-included) algorithm. */
function planBlueprintRebaseline(docs: ParsedDoc[], baseline: Baseline): { id: string; newHash: string }[] {
  return docs.filter(isBlueprint).flatMap((bp) => {
    const legacyHash = contentHash(bp.frontmatter, bp.node.body, { includeTasks: true });
    if (baseline.docs[bp.node.id] !== legacyHash) return [];
    const newHash = contentHash(bp.frontmatter, bp.node.body, { includeTasks: false });
    return newHash === legacyHash ? [] : [{ id: bp.node.id, newHash }];
  });
}

/** Work orders recording a blueprint hash that matches that blueprint's current pre-D9 hash: advance it to the new one. */
function planWorkOrderRebaseline(docs: ParsedDoc[]): { id: string; path: string; blueprintHashes: Record<string, string> }[] {
  const blueprintsById = new Map(docs.filter(isBlueprint).map((bp) => [bp.node.id, bp]));
  return docs
    .filter((d): d is ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'WO' }> } => d.frontmatter.type === 'WO')
    .flatMap((wo) => {
      const updates = Object.entries(wo.frontmatter.blueprint_hashes).reduce<Record<string, string>>((acc, [bpId, oldHash]) => {
        const bp = blueprintsById.get(bpId);
        if (!bp) return acc;
        const legacyHash = contentHash(bp.frontmatter, bp.node.body, { includeTasks: true });
        if (oldHash !== legacyHash) return acc;
        const newHash = contentHash(bp.frontmatter, bp.node.body, { includeTasks: false });
        return newHash === oldHash ? acc : { ...acc, [bpId]: newHash };
      }, {});
      return Object.keys(updates).length === 0
        ? []
        : [{ id: wo.node.id, path: wo.node.sourcePath, blueprintHashes: { ...wo.frontmatter.blueprint_hashes, ...updates } }];
    });
}

async function applyFieldChange(ops: EngineOps, change: MigrateDocsFieldChange): Promise<void> {
  if (change.changes.includes(GOVERNS_CHANGE)) await ops.renameFrontmatterField(change.id, 'governs', 'impacts_paths');
  if (change.changes.includes(STATUS_CHANGE)) await ops.updateDocument(change.id, { status: 'pending' });
}

export interface MigrateDocsOptions {
  /** Print the plan without writing anything. */
  dryRun?: boolean;
}

/**
 * ADR-002 D9: rewrites deprecated frontmatter aliases (`governs` -> `impacts_paths`, WO `status: todo` -> `pending`)
 * and re-baselines the `## Tareas` hash exclusion for blueprints (and the work orders built against them) that were
 * in sync before the algorithm change. Blueprints already drifted for unrelated reasons are left untouched (still
 * drifted). Idempotent: a second run plans no changes.
 */
export async function migrateDocs(engine: Engine, options: MigrateDocsOptions = {}): Promise<MigrateDocsResult> {
  const dryRun = options.dryRun ?? false;
  return engine.transaction(async (ops) => {
    const { docs } = await ops.scan();
    const baseline = await loadBaseline(ops.config.root);

    const fieldChanges = planFieldChanges(docs);
    const blueprintPlan = planBlueprintRebaseline(docs, baseline);
    const workOrderPlan = planWorkOrderRebaseline(docs);

    if (!dryRun) {
      for (const change of fieldChanges) await applyFieldChange(ops, change);
      if (blueprintPlan.length > 0) {
        const nextDocs = { ...baseline.docs };
        for (const { id, newHash } of blueprintPlan) nextDocs[id] = newHash;
        await saveBaseline(ops.config.root, { ...baseline, docs: nextDocs });
      }
      for (const wo of workOrderPlan) await ops.updateDocument(wo.id, { blueprint_hashes: wo.blueprintHashes });
    }

    const report = dryRun ? undefined : await ops.refresh();
    return {
      dryRun,
      fieldChanges,
      rebaselinedBlueprints: blueprintPlan.map((b) => b.id),
      rebaselinedWorkOrders: workOrderPlan.map((w) => w.id),
      report,
    };
  });
}
