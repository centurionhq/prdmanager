/**
 * better-auth 1.7.4 tables (SDD-006 §Modelo de datos), hand-built as static Drizzle `pgTable`s.
 *
 * Column names and constraints are transcribed from `getAuthTables({ plugins: [organization(),
 * twoFactor()] })` (import from `better-auth/db`) — the exact technique confirmed by the WO-083
 * learning test (`packages/server/tests/learning/better-auth-drizzle.test.ts`). That learning test
 * builds tables dynamically at runtime for a throwaway schema; this module instead hand-writes the
 * equivalent statically so `drizzle-kit generate` can diff a stable, reviewable schema and so these
 * tables live in the real `public` schema (not a `pgSchema`), matching how the server will use them.
 * The implicit `id` primary key (`text`, better-auth generates its own ids) is added by hand per
 * table, exactly as the learning test's `buildAuthSchema` does.
 *
 * These tables are global (no `org_id`, no RLS — SDD-006 §Modelo de datos) and are owned by
 * `prdm_owner`; `prdm_app` gets exactly the DML better-auth's Kysely-less drizzle adapter issues
 * against them (SELECT/INSERT/UPDATE/DELETE, granted in the migration SQL, never DDL).
 */
import { boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).notNull(),
  twoFactorEnabled: boolean('twoFactorEnabled').default(false),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // better-auth's `organization` plugin session extension; not `input` (server-managed) so it has
    // no application-level FK enforcement from better-auth itself, matching its own schema.
    activeOrganizationId: text('activeOrganizationId'),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true, mode: 'date' }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true, mode: 'date' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(),
  metadata: text('metadata'),
});

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organizationId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [index('member_organizationId_idx').on(table.organizationId), index('member_userId_idx').on(table.userId)],
);

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organizationId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).notNull(),
    inviterId: text('inviterId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_organizationId_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
    // WO-105: target of invitation_secrets' composite FK (packages/db/src/schema/invitations.ts) —
    // `id` alone is already unique (it's the primary key), but a composite FK's target must itself be a
    // unique key on exactly those two columns, same as `projects_id_org_id_key` for `projects`.
    unique('invitation_id_organization_id_key').on(table.id, table.organizationId),
  ],
);

export const twoFactor = pgTable(
  'twoFactor',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backupCodes').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failedVerificationCount').default(0),
    lockedUntil: timestamp('lockedUntil', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('twoFactor_secret_idx').on(table.secret), index('twoFactor_userId_idx').on(table.userId)],
);
