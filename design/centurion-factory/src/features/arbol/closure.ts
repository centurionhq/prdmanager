/**
 * Closure readiness for the "Cerrar feature" modal (WO-285), mirroring @prdm/core's
 * `closureReadiness` (PRD-002 §lifecycle) without importing it: this package is isolated
 * (ADR-007) and only recomputes the same five checks from the mock data.
 */
import { PROJECTS, WORK_ORDERS, getProject, workOrderProgress, type ClosureCheckName, type ClosureReadiness, type Feature } from '../../data';

const CURRENT_PROJECT_SLUG = 'prdmanager';

export interface ClosureCheckDisplay {
  readonly name: ClosureCheckName;
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ClosureResult {
  readonly ready: boolean;
  readonly checks: readonly ClosureCheckDisplay[];
  readonly projectDriftErrors: number;
}

const CHECK_LABELS: Record<ClosureCheckName, string> = {
  feature_exists: 'La feature existe',
  feature_approved: 'Está aprobada',
  blueprints_have_work_orders: 'Cada blueprint tiene órdenes',
  work_orders_done: 'Todas las órdenes están hechas',
  project_clean: 'El proyecto no tiene drift',
};

function ordersCountForBlueprint(blueprintId: string): number {
  return WORK_ORDERS.filter((wo) => wo.blueprintId === blueprintId).length;
}

function blueprintsCheck(feature: Feature): { readonly ok: boolean; readonly detail: string } {
  if (feature.blueprintIds.length === 0) {
    return { ok: false, detail: 'La feature todavía no tiene blueprints.' };
  }
  const counts = feature.blueprintIds.map((id) => ({ id, count: ordersCountForBlueprint(id) }));
  return {
    ok: counts.every((entry) => entry.count > 0),
    detail: counts.map((entry) => `${entry.id} tiene ${entry.count} órdenes`).join(', '),
  };
}

function ordersDoneCheck(featureId: string): { readonly ok: boolean; readonly detail: string } {
  const progress = workOrderProgress(featureId);
  if (progress.total === 0) return { ok: false, detail: 'Todavía no hay órdenes registradas.' };
  return { ok: progress.done === progress.total, detail: `${progress.done} de ${progress.total} hechas` };
}

/** Recomputes the five closure checks for `feature` against the current mock project state. */
export function computeClosureReadiness(feature: Feature): ClosureResult {
  const projectDriftErrors = getProject(CURRENT_PROJECT_SLUG)?.driftErrors ?? PROJECTS[0]?.driftErrors ?? 0;
  const blueprints = blueprintsCheck(feature);
  const orders = ordersDoneCheck(feature.id);
  const approved = feature.status === 'approved' || feature.status === 'closed';
  const projectClean = projectDriftErrors === 0;

  const checks: readonly ClosureCheckDisplay[] = [
    { name: 'feature_exists', label: CHECK_LABELS.feature_exists, ok: true, detail: `${feature.id} existe` },
    { name: 'feature_approved', label: CHECK_LABELS.feature_approved, ok: approved, detail: `Estado ${feature.status}` },
    { name: 'blueprints_have_work_orders', label: CHECK_LABELS.blueprints_have_work_orders, ok: blueprints.ok, detail: blueprints.detail },
    { name: 'work_orders_done', label: CHECK_LABELS.work_orders_done, ok: orders.ok, detail: orders.detail },
    {
      name: 'project_clean',
      label: CHECK_LABELS.project_clean,
      ok: projectClean,
      detail: projectClean
        ? 'El proyecto no tiene errores de drift abiertos.'
        : `Hay ${projectDriftErrors} errores de drift en el proyecto. Reconocelos o resolvelos antes de cerrar.`,
    },
  ];

  return { ready: checks.every((check) => check.ok), checks, projectDriftErrors };
}

export function toClosureReadiness(featureId: string, result: ClosureResult): ClosureReadiness {
  return {
    featureId,
    ready: result.ready,
    checks: result.checks.map(({ name, ok, detail }) => ({ name, ok, detail })),
  };
}

const SPANISH_COUNT = ['Cero', 'Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'];

/** "Cuatro de cinco checks pasan" (the summary line above the checklist). */
export function passSummary(checks: readonly ClosureCheckDisplay[]): string {
  const passCount = checks.filter((check) => check.ok).length;
  return `${SPANISH_COUNT[passCount] ?? passCount} de cinco checks pasan`;
}
