/**
 * What each project role can do (WO-305). Drives both the role picker hints and the
 * "Qué puede hacer cada rol" matrix on the Miembros screen.
 */
import type { ProjectRole } from '../../data';

export const PROJECT_ROLES: readonly ProjectRole[] = ['admin', 'editor', 'developer', 'commenter', 'viewer'];

export const ROLE_LABELS: Readonly<Record<ProjectRole, string>> = {
  admin: 'Admin',
  editor: 'Editor',
  developer: 'Developer',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export const ROLE_HINTS: Readonly<Record<ProjectRole, string>> = {
  admin: 'Puede publicar, reconocer drift, cerrar features y gestionar miembros.',
  editor: 'Puede comentar y editar documentos.',
  developer: 'Puede comentar y tomar órdenes de trabajo.',
  commenter: 'Puede ver y comentar.',
  viewer: 'Solo puede ver.',
};

export type PermissionKey =
  | 'view'
  | 'comment'
  | 'edit'
  | 'publish'
  | 'claimOrders'
  | 'acknowledgeDrift'
  | 'closeFeature'
  | 'manageMembers';

export const PERMISSION_LABELS: Readonly<Record<PermissionKey, string>> = {
  view: 'Ver',
  comment: 'Comentar',
  edit: 'Editar documentos',
  publish: 'Publicar',
  claimOrders: 'Tomar órdenes',
  acknowledgeDrift: 'Reconocer drift',
  closeFeature: 'Cerrar feature',
  manageMembers: 'Gestionar miembros',
};

export const PERMISSIONS_ORDER: readonly PermissionKey[] = [
  'view',
  'comment',
  'edit',
  'publish',
  'claimOrders',
  'acknowledgeDrift',
  'closeFeature',
  'manageMembers',
];

const ADMIN_ONLY: ReadonlySet<PermissionKey> = new Set(['publish', 'acknowledgeDrift', 'closeFeature', 'manageMembers']);

/** Ground truth for the permission matrix: view is universal, everything else is role-gated. */
export function hasPermission(role: ProjectRole, permission: PermissionKey): boolean {
  if (permission === 'view') return true;
  if (permission === 'comment') return role !== 'viewer';
  if (permission === 'edit') return role === 'admin' || role === 'editor';
  if (permission === 'claimOrders') return role === 'admin' || role === 'developer';
  return ADMIN_ONLY.has(permission) && role === 'admin';
}
