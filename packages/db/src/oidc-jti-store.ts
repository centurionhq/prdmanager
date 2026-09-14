/**
 * `oidc_used_jtis` repository (SDD-010 "Modo baseline de code-reports", WO-179): the single-use guard
 * for a GitHub Actions OIDC token's `jti` claim. Deliberately not tenant-scoped (see
 * `./schema/oidc.ts`'s module doc comment) — takes the raw `Pool` directly, same as
 * `buildLlmGlobalUsageRepository`.
 *
 * `claim` is a single `INSERT ... ON CONFLICT DO NOTHING`: Postgres's own unique index on `jti` is what
 * makes two concurrent claims of the same `jti` resolve to exactly one winner (`rowCount === 1`) and
 * one loser (`rowCount === 0`), with no read-then-write race window for either — an ordinary
 * check-then-insert from application code could let two concurrent callers both observe "not claimed
 * yet" before either writes.
 */
import type { Pool } from 'pg';
import { oidcUsedJtis } from './schema/oidc.js';
import { connect } from './pool.js';

export interface OidcJtiStore {
  /** Atomically records the first use of `jti`; returns `false` when it was already claimed (a
   * replay), `true` on a genuinely first claim. */
  claim(jti: string, expiresAt: Date): Promise<boolean>;
}

export function buildPgOidcJtiStore(pool: Pool): OidcJtiStore {
  const db = connect(pool);
  return {
    async claim(jti, expiresAt) {
      const result = await db.insert(oidcUsedJtis).values({ jti, expiresAt }).onConflictDoNothing({ target: oidcUsedJtis.jti }).returning({ jti: oidcUsedJtis.jti });
      return result.length > 0;
    },
  };
}
