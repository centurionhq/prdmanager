/**
 * `force_push_overrides` (SDD-010 "Modo baseline de code-reports", WO-181): the audited escape hatch
 * for "`head_sha` regresses behind the currently registered baseline head" — a project admin
 * authorizes exactly one specific `head_sha` (never "any future regression"), consumed (deleted) the
 * first time a matching CI-verified baseline-eligible report actually uses it, so a stale/leftover
 * override can never silently authorize a later, unrelated force-push.
 */
import { foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';
import { projects } from './projects.js';

export const forcePushOverrides = pgTable(
  'force_push_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    headSha: text('head_sha').notNull(),
    authorizedBy: text('authorized_by')
      .notNull()
      .references(() => user.id),
    authorizedAt: timestamp('authorized_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('force_push_overrides_project_head_sha_key').on(table.projectId, table.headSha),
    foreignKey({
      columns: [table.projectId, table.orgId],
      foreignColumns: [projects.id, projects.orgId],
      name: 'force_push_overrides_project_org_fk',
    }),
    index('force_push_overrides_org_id_idx').on(table.orgId),
  ],
);
