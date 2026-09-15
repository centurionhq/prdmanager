/**
 * `audit_log`, `platform_audit_log` and `platform_admins` (SDD-006 §Modelo de datos).
 *
 * `audit_log` is org-scoped (RLS enabled+forced, same policy shape as `projects`) and append-only:
 * the migration revokes UPDATE/DELETE/TRUNCATE from `prdm_app`, leaving only SELECT/INSERT. Its
 * `(project_id, org_id)` composite FK is only enforced when `project_id` is set (Postgres's default
 * `MATCH SIMPLE` never rejects a row where *any* FK column is `NULL`) — most audited actions are
 * project-scoped, but org-level actions (inviting a member, renaming the org) have no project.
 *
 * `platform_audit_log` has no `org_id` at all (superadmin actions, failed logins) and is even more
 * locked down: `prdm_app` gets `INSERT` only, no `SELECT` — reading goes through
 * `read_platform_audit_log`, a `SECURITY DEFINER` function owned by `prdm_owner` (hand-appended to the
 * migration) that checks the caller against `platform_admins` before returning any row.
 *
 * `platform_admins` doesn't exist yet anywhere else in this branch (WO-101, which owns the superadmin
 * bootstrap command, is still pending), so it's created here; `prdm_app` gets `SELECT` only — nothing
 * ever grants it INSERT/UPDATE/DELETE, which is exactly what WO-099's catalog test checks for.
 */
import { foreignKey, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';
import { projects } from './projects.js';

export const platformAdmins = pgTable('platform_admins', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  createdBy: text('created_by').references(() => user.id),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    target: text('target').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.orgId],
      foreignColumns: [projects.id, projects.orgId],
      name: 'audit_log_project_org_fk',
    }),
    index('audit_log_org_id_idx').on(table.orgId),
    index('audit_log_project_id_idx').on(table.projectId),
  ],
);

export const platformAuditLog = pgTable('platform_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  target: text('target'),
  metadata: jsonb('metadata').notNull().default({}),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

