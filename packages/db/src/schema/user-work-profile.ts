/**
 * `user_work_profile` (SDD-051 / PRD-033 R1): which of the three ways of working -- negocio, producto,
 * developer -- a person picked on the Planta's entry band, remembered per user.
 *
 * A table of its own rather than a column on `user_profile`: that row only exists once someone sets a
 * `handle`, which is `NOT NULL`, set-once and irreversible, and exists to claim work orders as
 * `dev:<handle>`. A person from the business side never sets one, so keeping a UX preference there
 * would force inventing a handle for them. `user_profile`'s whole invariant is immutability and
 * never-reuse; a preference that changes whenever its owner wants does not belong next to it.
 *
 * Like `user_profile` this is global per user: no `org_id`, no row-level security. The profile is a
 * routing decision, not tenant data and not a permission (PRD-033: "no introduce roles, RBAC ni cambia
 * la autorización existente"). If it ever needs to vary per project it becomes tenant data and a table
 * of its own with the `app.org_id` policy, falling back to this one.
 */
import { pgTable, text, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.js';

/** Kept in sync by hand with the CHECK constraint's literal below and with `WORK_PROFILES` in
 * `@prdm/contracts` (same convention as `HANDLE_PATTERN`): a schema package cannot import contracts. */
export const WORK_PROFILE_VALUES = ['negocio', 'producto', 'developer'] as const;

export const userWorkProfile = pgTable(
  'user_work_profile',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    profile: text('profile').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [check('user_work_profile_profile_check', sql`${table.profile} IN ('negocio', 'producto', 'developer')`)],
);
