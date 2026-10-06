import type { OrgRole, ProjectRole } from '@prdm/contracts';

/** Etiquetas en español de los roles de proyecto (SDD-089 D7). `Record<ProjectRole, string>` es
 * deliberado: un rol nuevo rompe el build en vez de mostrar el slug crudo. */
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  admin: 'Administrador',
  editor: 'Editor',
  developer: 'Developer',
  commenter: 'Comentarista',
  viewer: 'Lector',
};

/** Etiquetas en español de los roles de organización (SDD-089 D7). */
export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  member: 'Miembro',
};

/** Etiqueta de un rol de proyecto tal como llega de la API (puede ser un slug desconocido o venir
 * vacío): sin rol ⇒ «Sin rol asignado»; un slug que este build no conoce se muestra tal cual. */
export function projectRoleLabel(role: string | undefined): string {
  if (!role) return 'Sin rol asignado';
  return (PROJECT_ROLE_LABELS as Readonly<Record<string, string>>)[role] ?? role;
}

/** Etiqueta de un rol de organización; un slug desconocido se muestra tal cual. */
export function orgRoleLabel(role: string): string {
  return (ORG_ROLE_LABELS as Readonly<Record<string, string>>)[role] ?? role;
}
