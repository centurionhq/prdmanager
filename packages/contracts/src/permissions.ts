/**
 * Pure permission matrix (SDD-006 §Permisos, WO-106): `can(subject, action)`, no I/O, no database — kept
 * dependency-free in `packages/contracts` (rather than `packages/server`) so `packages/app` can also
 * import it to gate UI affordances without pulling in a server-only package (SDD-006 §Arquitectura:
 * "Dependencias en un solo sentido: ... contracts ← server; ... contracts, ... ← app").
 *
 * `subject.orgRole` is the caller's organization role (SDD-006 §Modelo de datos: `member.role`, better-
 * auth's own table) and `subject.projectRole` is their row in `project_members`, if any. SDD-006
 * §Permisos: "owner y admin de organización heredan admin de proyecto" — modeled here as resolving an
 * *effective* project role up front (owner/admin org role always wins over whatever `project_members`
 * says, including no row at all) rather than special-casing each action.
 *
 * Default deny: an action not present in {@link PERMISSION_MATRIX}, or an effective role the matrix
 * doesn't list for that action, is never granted — `can` only ever returns `true` for an explicit match.
 */
import type { OrgRole } from './organizations.js';

export const PROJECT_ROLES = ['admin', 'editor', 'developer', 'commenter', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Exactly the action list from SDD-006 §Permisos, left-to-right, top-to-bottom through the table. */
export const PERMISSION_ACTIONS = [
  'view',
  'comment',
  'submit_feedback',
  'delete_others_comments',
  'edit_document',
  'request_review',
  'restore_version',
  'use_agent',
  'accept_agent_proposal',
  'publish',
  'archive',
  'acknowledge_drift',
  'close_feature',
  'force_close_feature',
  'claim_work_order',
  'complete_work_order',
  'archive_work_order',
  'generate_work_orders',
  'report_code_preview',
  'manage_members',
  'manage_project_settings',
  'manage_ci_tokens',
  'import',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export interface PermissionSubject {
  /** The caller's role in the organization the resource belongs to, if they're a member at all. */
  orgRole?: OrgRole;
  /** The caller's role in `project_members` for the specific project, if they have a row there. */
  projectRole?: ProjectRole;
}

/**
 * One row per SDD-006 §Permisos table row, `projectRoles` listing every project role granted that
 * action (read top-to-bottom, left-to-right against the ✓ marks in the SDD).
 */
const PERMISSION_MATRIX: Readonly<Record<PermissionAction, readonly ProjectRole[]>> = {
  view: ['admin', 'editor', 'developer', 'commenter', 'viewer'],
  comment: ['admin', 'editor', 'developer', 'commenter'],
  submit_feedback: ['admin', 'editor', 'developer', 'commenter'],
  delete_others_comments: ['admin'],
  edit_document: ['admin', 'editor'],
  request_review: ['admin', 'editor'],
  restore_version: ['admin', 'editor'],
  use_agent: ['admin', 'editor'],
  accept_agent_proposal: ['admin', 'editor'],
  publish: ['admin'],
  archive: ['admin'],
  acknowledge_drift: ['admin'],
  close_feature: ['admin'],
  force_close_feature: ['admin'],
  claim_work_order: ['admin', 'editor', 'developer'],
  complete_work_order: ['admin', 'editor', 'developer'],
  archive_work_order: ['admin'],
  generate_work_orders: ['admin', 'editor'],
  report_code_preview: ['admin', 'editor', 'developer'],
  manage_members: ['admin'],
  manage_project_settings: ['admin'],
  manage_ci_tokens: ['admin'],
  import: ['admin'],
};

/** SDD-006 §Permisos: "owner y admin de organización heredan admin de proyecto" — an org owner/admin is
 * always treated as project admin, regardless of (or absent) `project_members` row; anyone else (a plain
 * org `member`, or no `orgRole` at all — e.g. a project shared via a CI token) uses their actual
 * `projectRole`, which is `undefined` (default deny) if they have no `project_members` row. */
function effectiveProjectRole(subject: PermissionSubject): ProjectRole | undefined {
  if (subject.orgRole === 'owner' || subject.orgRole === 'admin') return 'admin';
  return subject.projectRole;
}

/** Pure, synchronous, no I/O: `can({ orgRole, projectRole }, action)`. */
export function can(subject: PermissionSubject, action: PermissionAction): boolean {
  const role = effectiveProjectRole(subject);
  if (!role) return false;
  return PERMISSION_MATRIX[action].includes(role);
}
