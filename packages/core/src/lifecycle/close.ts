import { ACTOR_PATTERN, type ParsedDoc } from '../domain/schema.js';
import type { ProjectEngine, RefreshReport } from '../engine.js';

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

function architectingBlueprints(docs: readonly ParsedDoc[], featureId: string): ParsedDoc[] {
  return docs.filter((d) => d.node.label === 'Blueprint' && d.edges.some((e) => e.type === 'ARCHITECTS' && e.to === featureId));
}

function workOrdersImplementing(docs: readonly ParsedDoc[], blueprintId: string): ParsedDoc[] {
  return docs.filter((d) => d.node.label === 'WorkOrder' && d.edges.some((e) => e.type === 'IMPLEMENTS' && e.to === blueprintId));
}

/** Pure: the same five checks, given the documents and a (real or dry-run) refresh report. Never does I/O itself. */
function evaluateReadiness(docs: readonly ParsedDoc[], featureId: string, report: RefreshReport): ClosureReadiness {
  const checks: ClosureCheck[] = [];

  const feature = docs.find((d) => d.node.id === featureId);
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

  const errorCount = report.issues.filter((i) => i.severity === 'error').length + report.errors.length;
  checks.push({
    name: 'project_clean',
    ok: errorCount === 0,
    detail: errorCount === 0 ? 'refresh reports 0 error-level issues' : `refresh reports ${errorCount} error-level issue(s)/invalid document(s)`,
  });

  return { featureId, ready: checks.every((c) => c.ok), checks };
}

/**
 * Read-only closure gate for `prdm close` (PRD-002 §3 "Cierre"): a Feature is only closeable once it is
 * `approved`, every Blueprint architecting it has at least one Work Order implementing it, all of those Work
 * Orders are `done`, and a project-wide dry-run reports zero error-level issues. Never writes anything — not a
 * status field, not the baseline, not a graph snapshot (WO-023 finding 9): it reads straight from disk and uses
 * `engine.inspect()`, so it is safe to call without holding the repo lock.
 */
export async function closureReadiness(engine: ProjectEngine, featureId: string): Promise<ClosureReadiness> {
  const { docs } = await engine.scan();
  const report = await engine.inspect();
  return evaluateReadiness(docs, featureId, report);
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
 * Human closure gate (PRD-002 §3, ADR-002 D15: `prdm close` is CLI-only). Sequence matters: `closureReadiness`
 * runs first, outside any transaction, so a hopeless request fails fast with a clear report; readiness is then
 * re-checked a second time INSIDE the atomic transaction, under the repo lock, immediately before writing — a
 * document could otherwise have changed in the window between the first check and acquiring the lock, closing
 * a Feature that is no longer actually ready (WO-023 finding 9). `engine.acknowledge` is a separate call
 * afterwards, never from within the transaction (Engine's own contract: never call its public methods from
 * inside `transaction()`).
 */
export async function closeFeature(engine: ProjectEngine, featureId: string, options: CloseOptions): Promise<CloseResult> {
  if (!ACTOR_PATTERN.test(options.by)) throw new Error(`invalid "by" actor: ${options.by} (expected agent:name or dev:name)`);

  const readiness = await closureReadiness(engine, featureId);
  if (!readiness.ready) throw new Error(`${featureId} is not ready to close: ${describeFailures(readiness)}`);

  const closedAt = (options.now ?? new Date()).toISOString();
  await engine.transaction(
    async (ops) => {
      const docs = (await ops.scan()).docs;
      const recheck = evaluateReadiness(docs, featureId, await ops.inspect());
      if (!recheck.ready) throw new Error(`${featureId} is no longer ready to close (something changed since the readiness check): ${describeFailures(recheck)}`);
      await ops.updateDocument(featureId, { status: 'closed', closed_at: closedAt, closed_by: options.by });
      return ops.refresh();
    },
    { atomic: true },
  );

  const report = await engine.acknowledge(featureId);
  return { featureId, closedAt, closedBy: options.by, report };
}

function describeFailures(readiness: ClosureReadiness): string {
  return readiness.checks
    .filter((c) => !c.ok)
    .map((c) => `${c.name}: ${c.detail}`)
    .join('; ');
}
