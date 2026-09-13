import { ACTOR_PATTERN, type ParsedDoc } from '../domain/schema.js';
import type { Engine, RefreshReport } from '../engine.js';
import { scanDocuments } from '../parser/scan.js';

export interface ClosureCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ClosureReadiness {
  featureId: string;
  ready: boolean;
  checks: ClosureCheck[];
}

function architectingBlueprints(docs: ParsedDoc[], featureId: string): ParsedDoc[] {
  return docs.filter((d) => d.node.label === 'Blueprint' && d.edges.some((e) => e.type === 'ARCHITECTS' && e.to === featureId));
}

function workOrdersImplementing(docs: ParsedDoc[], blueprintId: string): ParsedDoc[] {
  return docs.filter((d) => d.node.label === 'WorkOrder' && d.edges.some((e) => e.type === 'IMPLEMENTS' && e.to === blueprintId));
}

/**
 * Read-only closure gate for `prdm close` (PRD-002 §3 "Cierre"): a Feature is only closeable once it is
 * `approved`, every Blueprint architecting it has at least one Work Order implementing it, all of those Work
 * Orders are `done`, and a full refresh reports zero error-level issues project-wide. Doc-level checks read
 * straight from disk (no lock needed for a read); the project-wide check runs a real `engine.refresh()`.
 */
export async function closureReadiness(engine: Engine, featureId: string): Promise<ClosureReadiness> {
  const { docs } = await scanDocuments(engine.config.root, engine.config.ignore);
  const feature = docs.find((d) => d.node.id === featureId);
  const checks: ClosureCheck[] = [];

  const exists = feature !== undefined && feature.node.label === 'Feature';
  checks.push({ name: 'feature_exists', ok: exists, detail: exists ? `${featureId} is a Feature` : `${featureId} was not found or is not a Feature` });

  const isApproved = exists && (feature.node.status === 'approved' || feature.node.status === 'closed');
  checks.push({
    name: 'feature_approved',
    ok: isApproved,
    detail: isApproved ? `${featureId} is approved` : `${featureId} must be status "approved" (is "${feature?.node.status ?? 'unknown'}")`,
  });

  const blueprints = exists ? architectingBlueprints(docs, featureId) : [];
  const blueprintsById = new Map(blueprints.map((bp) => [bp.node.id, workOrdersImplementing(docs, bp.node.id)]));
  const withoutWorkOrders = [...blueprintsById.entries()].filter(([, wos]) => wos.length === 0).map(([id]) => id);
  checks.push({
    name: 'blueprints_have_work_orders',
    ok: withoutWorkOrders.length === 0,
    detail: withoutWorkOrders.length === 0 ? 'every blueprint architecting it has at least one work order' : `blueprint(s) without a work order: ${withoutWorkOrders.join(', ')}`,
  });

  const allWorkOrders = [...blueprintsById.values()].flat();
  const pending = allWorkOrders.filter((wo) => wo.frontmatter.type === 'WO' && wo.frontmatter.status !== 'done');
  checks.push({
    name: 'work_orders_done',
    ok: pending.length === 0,
    detail: pending.length === 0 ? 'all work orders implementing its blueprints are done' : `pending work order(s): ${pending.map((wo) => wo.node.id).join(', ')}`,
  });

  const report = await engine.refresh();
  const errorCount = report.issues.filter((i) => i.severity === 'error').length + report.errors.length;
  checks.push({
    name: 'project_clean',
    ok: errorCount === 0,
    detail: errorCount === 0 ? 'refresh reports 0 error-level issues' : `refresh reports ${errorCount} error-level issue(s)/invalid document(s)`,
  });

  return { featureId, ready: checks.every((c) => c.ok), checks };
}

export interface CloseOptions {
  by: string;
  now?: Date;
}

export interface CloseResult {
  featureId: string;
  closedAt: string;
  closedBy: string;
  report: RefreshReport;
}

/**
 * Human closure gate (PRD-002 §3, ADR-002 D14: `prdm close` is CLI-only). Sequence matters: `closureReadiness`
 * runs before any transaction (it calls the public `engine.refresh()`); the write happens inside a single
 * transaction using only `EngineOps`; `engine.acknowledge` is a separate call afterwards, never from within the
 * transaction (Engine's own contract: never call its public methods from inside `transaction()`).
 */
export async function closeFeature(engine: Engine, featureId: string, options: CloseOptions): Promise<CloseResult> {
  if (!ACTOR_PATTERN.test(options.by)) throw new Error(`invalid "by" actor: ${options.by} (expected agent:name or dev:name)`);

  const readiness = await closureReadiness(engine, featureId);
  if (!readiness.ready) {
    const failing = readiness.checks
      .filter((c) => !c.ok)
      .map((c) => `${c.name}: ${c.detail}`)
      .join('; ');
    throw new Error(`${featureId} is not ready to close: ${failing}`);
  }

  const closedAt = (options.now ?? new Date()).toISOString();
  await engine.transaction(async (ops) => {
    await ops.updateDocument(featureId, { status: 'closed', closed_at: closedAt, closed_by: options.by });
    return ops.refresh();
  });

  const report = await engine.acknowledge(featureId);
  return { featureId, closedAt, closedBy: options.by, report };
}
