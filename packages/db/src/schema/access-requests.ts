/**
 * `access_request` (SDD-099 §D1): a public "pedir acceso a una organización" request.
 *
 * Org-scoped (`org_id NOT NULL`, RLS enabled+forced with the same `NULLIF` policy shape as
 * `projects`/`invitation_secrets`), so every read/write goes through `withTenantTx`. `email` is stored
 * already lower-cased by the writer (the repository normalizes it); `name`/`message` carry no length caps
 * here — those belong to the zod contract. `resolvedBy` has no FK on purpose: it is the actor that
 * resolved the request (a better-auth `user.id` or a `dev:`/`agent:` actor), not a product data entity.
 */
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization } from './auth.js';

export const accessRequestStatus = pgEnum('access_request_status', ['pending', 'approved', 'rejected']);

export const accessRequest = pgTable(
  'access_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    message: text('message'),
    status: accessRequestStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    resolvedBy: text('resolved_by'),
  },
  (table) => [index('access_request_org_id_status_idx').on(table.orgId, table.status)],
);
