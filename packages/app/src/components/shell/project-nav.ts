/**
 * Primary project navigation (SDD-013 §"Shell y router", ported from `design/centurion-factory`'s own
 * `PRIMARY_NAV`): the same six destinations, now built from the real `orgSlug`/`projectSlug` in the URL
 * instead of a hardcoded single-project mock.
 */
export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly shortLabel: string;
  /** Match only the exact path (never a nested route) — same meaning as `NavLink`'s own `end` prop. */
  readonly end: boolean;
}

export function projectBasePath(orgSlug: string, projectSlug: string): string {
  return `/o/${orgSlug}/p/${projectSlug}`;
}

export function buildPrimaryNav(orgSlug: string, projectSlug: string): readonly NavItem[] {
  const base = projectBasePath(orgSlug, projectSlug);
  return [
    { to: base, label: 'Planta', shortLabel: 'Planta', end: true },
    { to: `${base}/arbol`, label: 'Árbol de features', shortLabel: 'Árbol', end: false },
    { to: `${base}/documents`, label: 'Documentos', shortLabel: 'Docs', end: false },
    { to: `${base}/ordenes`, label: 'Órdenes de trabajo', shortLabel: 'Órdenes', end: false },
    { to: `${base}/drift`, label: 'Drift', shortLabel: 'Drift', end: false },
    { to: `${base}/entrada`, label: 'Bandeja de entrada', shortLabel: 'Entrada', end: false },
  ];
}

const PROJECT_ROLE_LABEL: Record<string, string> = {
  admin: 'Admin de proyecto',
  editor: 'Editor',
  developer: 'Developer',
  commenter: 'Comentarista',
  viewer: 'Viewer',
};

export function projectRoleLabel(role: string | undefined): string {
  if (!role) return 'Sin rol asignado';
  return PROJECT_ROLE_LABEL[role] ?? role;
}

/** Two-letter avatar initials from a display name (e.g. "Ana Ríos" → "AR"), falling back to the first
 * two letters of an email's local part when there's no space-separated name. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
