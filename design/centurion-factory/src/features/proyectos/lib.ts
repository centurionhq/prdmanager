/**
 * Pure helpers for the Proyectos screen (WO-303): slug derivation/validation, the accessible
 * line-status label, the drift summary per project and a relative "last activity" formatter.
 */
import { STATIONS, STATION_LABELS, type ProjectSummary, type Station } from '../../data';
import { formatRelativeCalendar } from '../../lib/format-date';

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

/** Relative "last activity" label; falls back to an absolute `dd/mm/yyyy` date past a week. */
export function formatRelativeActivity(iso: string, now: Date = new Date()): string {
  return formatRelativeCalendar(iso, { now });
}
