/**
 * Pure helpers for the Proyectos screen (WO-303): slug derivation/validation, the accessible
 * line-status label, the drift summary per project and a relative "last activity" formatter.
 */
import { STATIONS, STATION_LABELS, type ProjectSummary, type Station } from '../../data';

const DIACRITICS_PATTERN = /[̀-ͯ]/g;
const NON_SLUG_PATTERN = /[^a-z0-9]+/g;
const EDGE_HYPHENS_PATTERN = /^-+|-+$/g;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '')
    .replace(NON_SLUG_PATTERN, '-')
    .replace(EDGE_HYPHENS_PATTERN, '');
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function stationIndex(station: Station): number {
  return STATIONS.indexOf(station) + 1;
}

export function lineLabel(project: Pick<ProjectSummary, 'furthestStation' | 'andonStation'>): string {
  const reached = `Llega a ${STATION_LABELS[project.furthestStation]}`;
  if (!project.andonStation) return reached;
  return `${reached}, detenida en ${STATION_LABELS[project.andonStation]}`;
}

export function roleLabel(role: string): string {
  return role.length === 0 ? role : role.charAt(0).toUpperCase() + role.slice(1);
}

export type DriftTone = 'error' | 'warning' | 'ok' | 'awaiting';

export interface DriftSummary {
  readonly tone: DriftTone;
  readonly label: string;
}

export function driftSummary(
  project: Pick<ProjectSummary, 'driftErrors' | 'driftWarnings' | 'awaitingFirstReport'>,
): DriftSummary {
  if (project.driftErrors > 0) {
    return { tone: 'error', label: `${project.driftErrors} ${project.driftErrors === 1 ? 'error' : 'errores'}` };
  }
  if (project.driftWarnings > 0) {
    return { tone: 'warning', label: `${project.driftWarnings} ${project.driftWarnings === 1 ? 'aviso' : 'avisos'}` };
  }
  if (project.awaitingFirstReport) {
    return { tone: 'awaiting', label: 'Esperando primer reporte de CI' };
  }
  return { tone: 'ok', label: 'Sin drift' };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function sameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Relative "last activity" label; falls back to an absolute `dd/mm/yyyy` date past a week. */
export function formatRelativeActivity(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();

  if (diffMs < MINUTE_MS) return 'ahora';
  if (diffMs < HOUR_MS) return `hace ${Math.round(diffMs / MINUTE_MS)} min`;
  if (sameUtcDay(then, now)) return `hace ${Math.round(diffMs / HOUR_MS)} h`;

  const yesterday = new Date(now.getTime() - DAY_MS);
  if (sameUtcDay(then, yesterday)) return 'ayer';
  if (diffMs < WEEK_MS) return `hace ${Math.round(diffMs / DAY_MS)} d`;

  return `${pad(then.getUTCDate())}/${pad(then.getUTCMonth() + 1)}/${then.getUTCFullYear()}`;
}
