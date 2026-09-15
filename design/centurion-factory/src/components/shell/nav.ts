export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly shortLabel: string;
  /** Match nested routes (e.g. /documentos/:id keeps Documentos active). */
  readonly end: boolean;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { to: '/', label: 'Planta', shortLabel: 'Planta', end: true },
  { to: '/arbol', label: 'Árbol de features', shortLabel: 'Árbol', end: false },
  { to: '/documentos', label: 'Documentos', shortLabel: 'Docs', end: false },
  { to: '/ordenes', label: 'Órdenes de trabajo', shortLabel: 'Órdenes', end: false },
  { to: '/drift', label: 'Drift', shortLabel: 'Drift', end: false },
  { to: '/entrada', label: 'Bandeja de entrada', shortLabel: 'Entrada', end: false },
];

export const APP_NAME = 'Centurion Factory';
export const CURRENT_ORG = 'Centurion HQ';
export const CURRENT_PROJECT = 'prdmanager';

export function documentTitle(routeTitle: string | undefined): string {
  return routeTitle ? `${routeTitle} · ${APP_NAME}` : APP_NAME;
}
