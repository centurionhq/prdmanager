/**
 * Projects of the Centurion HQ organization (WO-272), exactly as in the canvas round-3 sidebar
 * update. `driftErrors`/`driftWarnings` reflect the current official report (matches the "Drift 3"
 * sidebar badge and the Drift screen header), not the full historical DRIFT_ISSUES list in
 * drift.ts, which also keeps resolved/older issues for coverage.
 */
import type { ProjectSummary } from './types';

export const PROJECTS: readonly ProjectSummary[] = [
  {
    slug: 'prdmanager',
    name: 'prdmanager',
    documentCount: 292,
    archived: false,
    furthestStation: 'cierre',
    andonStation: 'ejecucion',
    driftErrors: 3,
    driftWarnings: 3,
    awaitingFirstReport: false,
    workOrdersInProgress: 9,
    role: 'admin',
    lastActivity: '2026-09-15T09:56:00.000Z',
  },
  {
    slug: 'centurion-core',
    name: 'centurion-core',
    documentCount: 48,
    archived: true,
    furthestStation: 'cierre',
    driftErrors: 0,
    driftWarnings: 0,
    awaitingFirstReport: false,
    workOrdersInProgress: 0,
    role: 'viewer',
    lastActivity: '2026-06-01T10:00:00.000Z',
  },
  {
    slug: 'ystream',
    name: 'ystream',
    documentCount: 41,
    archived: false,
    furthestStation: 'ejecucion',
    driftErrors: 0,
    driftWarnings: 0,
    awaitingFirstReport: false,
    workOrdersInProgress: 2,
    role: 'editor',
    lastActivity: '2026-09-14T12:00:00.000Z',
  },
  {
    slug: 'dbmazz',
    name: 'dbmazz',
    documentCount: 67,
    archived: false,
    furthestStation: 'ejecucion',
    andonStation: 'ejecucion',
    driftErrors: 0,
    driftWarnings: 1,
    awaitingFirstReport: false,
    workOrdersInProgress: 3,
    role: 'developer',
    lastActivity: '2026-09-13T09:00:00.000Z',
  },
  {
    slug: 'data-report-ms',
    name: 'data-report-ms',
    documentCount: 12,
    archived: false,
    furthestStation: 'planificacion',
    driftErrors: 0,
    driftWarnings: 0,
    awaitingFirstReport: true,
    workOrdersInProgress: 1,
    role: 'commenter',
    lastActivity: '2026-09-11T15:00:00.000Z',
  },
];

export function getProject(slug: string): ProjectSummary | undefined {
  return PROJECTS.find((project) => project.slug === slug);
}
