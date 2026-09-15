/**
 * `oidc_used_jtis` (SDD-010 "Modo baseline de code-reports", WO-179): single-use replay protection for
 * a GitHub Actions OIDC token's `jti` claim. Deliberately global (no `org_id`, no RLS, same reasoning
 * as `llm_global_usage` — see `./agent.ts`'s module doc comment): a `jti` identifies one GitHub Actions
 * job run regardless of which prdm organization eventually verifies its token, so scoping reuse
 * detection per-tenant would still let the exact same token be replayed against a *different*
 * organization's project. `expires_at` mirrors the token's own `exp` claim purely so a future cleanup
 * job can prune old rows — nothing here ever reads it to decide whether a `jti` is still "in use" (a
 * `jti` is single-use forever, not just until its token would have expired anyway).
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const oidcUsedJtis = pgTable('oidc_used_jtis', {
  jti: text('jti').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
