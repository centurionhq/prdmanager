/**
 * `api_tokens` (SDD-006 §Modelo de datos / §Permisos "Scopes de tokens", WO-109).
 *
 * Same RLS shape as every other tenant table (`org_id NOT NULL`, ENABLE+FORCE, NULLIF policy,
 * hand-appended below drizzle-kit's own output in the migration this schema generates). Two kinds:
 * `personal` (tied to a `user_id`, scoped to `mcp:*`/`governance:read`/`reports:write`/`import:write`)
 * and `project_ci` (`user_id` null, scoped to a fixed `project_ids` array, limited to
 * `governance:read`/`reports:write`/`reports:baseline` — SDD-006 §Permisos table). `secret_hash` is
 * `UNIQUE` (the sha256 of the 32 random secret bytes, never the secret itself) so `resolve_token`
 * (hand-appended `SECURITY DEFINER` function, same WO-097 template as `resolve_project`/
 * `resolve_invitation`) can look a token up before any `org_id` is known. `expires_at` is `NOT NULL`
 * with a `CHECK` capping it at 90 days from `created_at` — SDD-006: "expiración obligatoria ... hasta
 * 90 días" — enforced again in application code (`createPersonalToken`/`createCiToken`) since a
 * `CHECK` alone can't reject a request before insertion with a friendly error.
 *
 * `project_ids` elements are validated against `projects(id, org_id)` only through application code
 * (an array column can't carry a per-element composite FK): `assertProjectIdsBelongToOrg` in
 * `../tokens.ts` checks every id resolves to this org before insertion.
 */
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organization, user } from './auth.js';

export const apiTokenKind = pgEnum('api_token_kind', ['personal', 'project_ci']);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: apiTokenKind('kind').notNull(),
    /** `null` for `project_ci` tokens (SDD-006 §Modelo de datos: "user_id (null para CI)"). */
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    /** `null` for `personal` tokens; a fixed, immutable set of project uuids for `project_ci` tokens. */
    projectIds: uuid('project_ids').array(),
    name: text('name').notNull(),
    /** Visible prefix (`prdm_pat_`/`prdm_ci_` + short id + checksum digits) so secret scanners can
     * flag a leaked token even without the hash — never used for lookup (that's `secretHash`). */
    prefix: text('prefix').notNull(),
    /** sha256 hex of the 32 random secret bytes; the only column `resolve_token` matches on. */
    secretHash: text('secret_hash').notNull().unique(),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'api_tokens_kind_user_id_check',
      sql`(${table.kind} = 'personal' AND ${table.userId} IS NOT NULL) OR (${table.kind} = 'project_ci' AND ${table.userId} IS NULL)`,
    ),
    check('api_tokens_expires_at_max_90d_check', sql`${table.expiresAt} <= ${table.createdAt} + interval '90 days'`),
    index('api_tokens_org_id_idx').on(table.orgId),
    index('api_tokens_user_id_idx').on(table.userId),
  ],
);
