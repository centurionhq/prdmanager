/**
 * `invitation_secrets` and `project_invitation_grants` (SDD-006 §Modelo de datos, WO-105).
 *
 * Both are org-scoped (`org_id NOT NULL`, RLS enabled+forced with the same `NULLIF` policy shape as
 * `projects`/`audit_log`) even though the one path that reads them *before* `app.org_id` is known
 * (invitation acceptance) never queries these tables directly with RLS in effect — it goes through
 * `resolve_invitation`, a `SECURITY DEFINER` function (hand-appended to this migration) that runs as
 * `prdm_owner` and therefore bypasses RLS entirely, exactly like `read_platform_audit_log`
 * (`packages/db/migrations/0002_audit_log_and_platform_admins.sql`). Once the accepting request knows
 * `org_id` (the function's own return value), every further read/write goes through `withTenantTx` like
 * any other org-scoped table.
 *
 * `invitation_secrets.invitationId` is *also* the primary key (one secret per invitation, 1:1) and a
 * plain FK to `invitation.id` — not composite, since `invitation_secrets` doesn't reference a project.
 * `project_invitation_grants` does reference a project, so its `(project_id, org_id)` FK is composite
 * against `projects(id, org_id)` (the exact mechanism SDD-006 relies on to make a cross-org project
 * reference fail at the FK, same as `project_members`).
 */
import { foreignKey, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { invitation, organization } from './auth.js';
import { projectRole, projects } from './projects.js';

export const invitationSecrets = pgTable(
  'invitation_secrets',
  {
    invitationId: text('invitation_id')
      .primaryKey()
      .references(() => invitation.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** sha256 of a 32-byte random secret, distinct from `invitation.id` (SDD-006 §Autenticación). */
    secretHash: text('secret_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('invitation_secrets_org_id_idx').on(table.orgId), index('invitation_secrets_secret_hash_idx').on(table.secretHash)],
);

export const projectInvitationGrants = pgTable(
  'project_invitation_grants',
  {
    invitationId: text('invitation_id')
      .notNull()
      .references(() => invitation.id, { onDelete: 'cascade' }),
    orgId: text('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    role: projectRole('role').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.invitationId, table.projectId], name: 'project_invitation_grants_pkey' }),
    foreignKey({
      columns: [table.projectId, table.orgId],
      foreignColumns: [projects.id, projects.orgId],
      name: 'project_invitation_grants_project_org_fk',
    }),
    index('project_invitation_grants_org_id_idx').on(table.orgId),
    index('project_invitation_grants_invitation_id_idx').on(table.invitationId),
  ],
);
