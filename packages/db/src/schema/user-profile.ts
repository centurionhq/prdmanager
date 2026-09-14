/**
 * `user_profile` and `retired_handles` (SDD-006 §Modelo de datos).
 *
 * `handle` must satisfy the handle half of `@prdm/core`'s `ACTOR_PATTERN`
 * (`/^(agent|dev):[A-Za-z0-9._-]{1,64}$/`) so `dev:<handle>` is always a valid core actor; the CHECK
 * constraint below is generated into the migration and mirrors that exact character class and length.
 *
 * Immutability and never-reuse are enforced in the database, not just in application code (the
 * migration hand-appends triggers for both, see `packages/db/migrations/`):
 *  - `user_profile_forbid_handle_update`: a BEFORE UPDATE trigger rejects any statement that changes
 *    `handle` (rewriting the same value back is fine; only `IS DISTINCT FROM` triggers it).
 *  - `retired_handles` plus `user_profile_guard_handle_reuse`: a BEFORE INSERT trigger inserts the new
 *    handle into `retired_handles` in the same transaction, relying on that table's own primary key to
 *    turn a reused handle into a unique-violation. Rows are never removed from `retired_handles`, so a
 *    handle stays retired forever even after its `user_profile` row is deleted (e.g. cascaded from a
 *    deleted `user`).
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.js';

/** Kept in sync by hand with the CHECK constraint's literal regex below and with `@prdm/core`'s `ACTOR_PATTERN`. */
export const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export const userProfile = pgTable(
  'user_profile',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    handle: text('handle').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [check('user_profile_handle_charset', sql`${table.handle} ~ '^[A-Za-z0-9._-]{1,64}$'`)],
);

export const retiredHandles = pgTable('retired_handles', {
  handle: text('handle').primaryKey(),
  retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
