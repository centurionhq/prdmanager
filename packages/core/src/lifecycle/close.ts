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
  // SDD-018 "Archivado de Work Orders": an archived work order is excluded from "pending" the same as a
  // done one — archiving alone is enough to satisfy this check, without needing force-close.
  const pending = allWorkOrders.filter((wo) => wo.frontmatter.type === 'WO' && wo.frontmatter.status !== 'done' && wo.frontmatter.status !== 'archived');
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

/**
 * SDD-018 "Archivado de Work Orders y cierre forzado auditado": the exhaustive, deliberately explicit set
 * of `ClosureCheck.name`s a force-close may bypass. Written as an explicit literal union (not derived from
 * `ClosureCheck['name']` via `Omit`/`Exclude`) so `feature_exists`/`feature_approved` are structurally
 * impossible to name in a `bypass` array — a caller would need an unsafe cast to even attempt it, and
 * {@link filterBypassableFailures} below still refuses to honor one even then.
 */
export type ForceCloseBypassableCheck = 'blueprints_have_work_orders' | 'work_orders_done' | 'project_clean';

const FORCE_CLOSE_BYPASSABLE_CHECK_NAMES: ReadonlySet<string> = new Set<ForceCloseBypassableCheck>(['blueprints_have_work_orders', 'work_orders_done', 'project_clean']);

export interface BypassedCheck {
  name: ForceCloseBypassableCheck;
  detail: string;
}

interface FilteredReadiness {
  ready: boolean;
  blocking: ClosureCheck[];
  bypassed: BypassedCheck[];
}

/**
 * Splits a readiness result's failing checks into those `bypass` actually covers and those that still
 * block. Defense in depth against a `bypass` array built through an unsafe cast (see
 * {@link ForceCloseBypassableCheck}'s own doc comment): a failing check only ever counts as bypassed when
 * its name is BOTH in `bypass` AND in {@link FORCE_CLOSE_BYPASSABLE_CHECK_NAMES} — `feature_exists`/
 * `feature_approved` are never in the latter, so they can never be bypassed no matter what `bypass` claims.
 */
function filterBypassableFailures(readiness: ClosureReadiness, bypass: readonly ForceCloseBypassableCheck[]): FilteredReadiness {
  const requested = new Set<string>(bypass);
  const failing = readiness.checks.filter((c) => !c.ok);
  const bypassed: BypassedCheck[] = [];
  const blocking: ClosureCheck[] = [];
  for (const check of failing) {
    if (FORCE_CLOSE_BYPASSABLE_CHECK_NAMES.has(check.name) && requested.has(check.name)) {
      bypassed.push({ name: check.name as ForceCloseBypassableCheck, detail: check.detail });
    } else {
      blocking.push(check);
    }
  }
  return { ready: blocking.length === 0, blocking, bypassed };
}

function describeBlocking(blocking: readonly ClosureCheck[]): string {
  return blocking.map((c) => `${c.name}: ${c.detail}`).join('; ');
}

export interface ForceCloseOptions {
  by: string;
  /** Mandatory, never defaultable (same `prdm close --ack` precedent as a deliberate confirmation: a
   * bare boolean flag is too easy to pass without thinking about it). */
  reason: string;
  bypass: ForceCloseBypassableCheck[];
  now?: Date;
}

export interface ForceCloseResult {
  featureId: string;
  closedAt: string;
  closedBy: string;
  reason: string;
  /** The full detail of every check this force-close actually bypassed (name + detail, not just a
   * count or a list of names), so it can be fully audited. */
  bypassed: BypassedCheck[];
  report: RefreshReport;
}

/**
 * Audited, admin-only escape hatch for `closeFeature`'s hard gate (SDD-018): closes a Feature even when
 * one or more of `blueprints_have_work_orders`/`work_orders_done`/`project_clean` fail, as long as every
 * OTHER failing check (`feature_exists`/`feature_approved`, always) passes. Mirrors `closeFeature`'s own
 * TOCTOU-safe structure exactly: `closureReadiness` runs once outside any transaction so a hopeless
 * request fails fast, then is re-evaluated a second time INSIDE the atomic transaction, under the repo
 * lock, immediately before writing — the same reasoning as `closeFeature`'s own doc comment (WO-023
 * finding 9), now also covering the case where a concurrent change makes the bypass no longer cover
 * everything that's failing.
 */
export async function forceCloseFeature(engine: ProjectEngine, featureId: string, options: ForceCloseOptions): Promise<ForceCloseResult> {
  if (!ACTOR_PATTERN.test(options.by)) throw new Error(`invalid "by" actor: ${options.by} (expected agent:name or dev:name)`);
  if (options.reason.trim().length === 0) throw new Error('reason is required to force-close a feature');

  const readiness = await closureReadiness(engine, featureId);
  const evaluated = filterBypassableFailures(readiness, options.bypass);
  if (!evaluated.ready) throw new Error(`${featureId} is not ready to force-close: ${describeBlocking(evaluated.blocking)}`);

  const closedAt = (options.now ?? new Date()).toISOString();
  let bypassed: BypassedCheck[] = evaluated.bypassed;
  await engine.transaction(
    async (ops) => {
      const docs = (await ops.scan()).docs;
      const recheck = evaluateReadiness(docs, featureId, await ops.inspect());
      const recheckEvaluated = filterBypassableFailures(recheck, options.bypass);
      if (!recheckEvaluated.ready) {
        throw new Error(`${featureId} is no longer ready to force-close (something changed since the readiness check): ${describeBlocking(recheckEvaluated.blocking)}`);
      }
      bypassed = recheckEvaluated.bypassed;
      await ops.updateDocument(featureId, { status: 'closed', closed_at: closedAt, closed_by: options.by, close_reason: options.reason, closed_forced: true });
      return ops.refresh();
    },
    { atomic: true },
  );

  const report = await engine.acknowledge(featureId);
  return { featureId, closedAt, closedBy: options.by, reason: options.reason, bypassed, report };
}
