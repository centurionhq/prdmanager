/**
 * Token quota reservation (SDD-009 §Seguridad y costo: "tope diario de tokens y requests por
 * organización ... tope global diario con corte automático para proteger la clave compartida ... reserva
 * de tokens antes de llamar (los turnos concurrentes no exceden la cuota)"; WO-175).
 *
 * `reserveAgentTokens` is called *before* the agent loop ever calls the model, reserving a fixed
 * `reservationTokens` budget (the endpoint passes `maxTokensPerTurn`, the same cap the loop itself
 * enforces per turn) against both the per-organization and the global daily counters *atomically*, so two
 * concurrent turns (different users of the same org, or different orgs racing the shared global cap) can
 * never both observe "under the limit" and both proceed past it — a classic check-then-act race that a
 * naive "read current total, compare, then increment" would have.
 *
 * Atomicity mechanism: a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE <still under the limit>
 * RETURNING ...` per counter — Postgres evaluates the `WHERE` against the row as it exists *at the moment
 * of the conflicting update*, under the row's own lock, so two concurrent statements against the same
 * `(org_id, usage_date)` row serialize through Postgres's own MVCC/row-lock machinery; whichever loses the
 * race simply gets zero rows back (not an error) and is treated as quota-exceeded. Both counters are
 * checked/incremented inside one `withTenantTx` transaction (which — unlike `llm_usage` — `llm_global_usage`
 * has no RLS to interact with, so it's reachable from the same tenant-scoped transaction without issue):
 * if the org reservation succeeds but the global one doesn't, throwing rolls the whole transaction back,
 * so the org counter is never left holding a reservation for a turn that will never actually run.
 *
 * `reconcileAgentTokens` is called once the turn actually finishes, adjusting both counters by
 * `actualTokens - reservationTokens` (negative when the turn used less than reserved, crediting the
 * difference back rather than wasting it for the rest of the day) — this adjustment is a plain increment,
 * never re-checked against the limit, since the capacity was already reserved.
 */
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { withTenantTx } from '@prdm/db';

export interface AgentQuotaLimits {
  dailyTokensPerOrg: number;
  dailyTokensGlobal: number;
}

export type ReserveAgentTokensResult = { ok: true } | { ok: false; reason: 'org_quota_exceeded' | 'global_quota_exceeded' };

/** Thrown only to unwind `withTenantTx`'s transaction when the org reservation succeeded but the global
 * one didn't — never leaks past {@link reserveAgentTokens} itself. */
class GlobalQuotaExceededSignal extends Error {}

/** `usageDate` is the caller's own "today" (SDD-009's daily counters reset once per day) — threaded in
 * rather than computed here so a test can control it precisely without mocking `Date`. */
export async function reserveAgentTokens(pool: Pool, orgId: string, reservationTokens: number, limits: AgentQuotaLimits, usageDate: string): Promise<ReserveAgentTokensResult> {
  // Guards the one case the ON CONFLICT ... WHERE below can't catch on its own: the very first
  // reservation of the day for a given org/globally always succeeds via the plain INSERT branch (no
  // conflict to apply a WHERE to yet) — if a single reservation alone already exceeds the daily limit,
  // reject it upfront rather than ever letting requestCount's very first row post an over-limit value.
  if (reservationTokens > limits.dailyTokensPerOrg) return { ok: false, reason: 'org_quota_exceeded' };
  if (reservationTokens > limits.dailyTokensGlobal) return { ok: false, reason: 'global_quota_exceeded' };

  try {
    return await withTenantTx(pool, orgId, async (tx) => {
      const orgResult = await tx.execute<{ total_tokens: number }>(sql`
        INSERT INTO llm_usage (org_id, usage_date, total_tokens, request_count)
        VALUES (${orgId}, ${usageDate}::date, ${reservationTokens}, 1)
        ON CONFLICT (org_id, usage_date) DO UPDATE SET
          total_tokens = llm_usage.total_tokens + ${reservationTokens},
          request_count = llm_usage.request_count + 1,
          updated_at = now()
        WHERE llm_usage.total_tokens + ${reservationTokens} <= ${limits.dailyTokensPerOrg}
        RETURNING total_tokens
      `);
      if (orgResult.rows.length === 0) return { ok: false as const, reason: 'org_quota_exceeded' as const };

      const globalResult = await tx.execute<{ total_tokens: number }>(sql`
        INSERT INTO llm_global_usage (usage_date, total_tokens, request_count)
        VALUES (${usageDate}::date, ${reservationTokens}, 1)
        ON CONFLICT (usage_date) DO UPDATE SET
          total_tokens = llm_global_usage.total_tokens + ${reservationTokens},
          request_count = llm_global_usage.request_count + 1,
          updated_at = now()
        WHERE llm_global_usage.total_tokens + ${reservationTokens} <= ${limits.dailyTokensGlobal}
        RETURNING total_tokens
      `);
      if (globalResult.rows.length === 0) throw new GlobalQuotaExceededSignal();

      return { ok: true as const };
    });
  } catch (error: unknown) {
    if (error instanceof GlobalQuotaExceededSignal) return { ok: false, reason: 'global_quota_exceeded' };
    throw error;
  }
}

/** Adjusts both counters by `actualTokens - reservationTokens` — a plain (possibly negative) increment,
 * never re-checked against the limit (the capacity was already reserved by {@link reserveAgentTokens}). */
export async function reconcileAgentTokens(pool: Pool, orgId: string, reservationTokens: number, actualTokens: number, usageDate: string): Promise<void> {
  const delta = actualTokens - reservationTokens;
  if (delta === 0) return;
  await withTenantTx(pool, orgId, async (tx) => {
    await tx.execute(sql`
      UPDATE llm_usage SET total_tokens = total_tokens + ${delta}, updated_at = now() WHERE org_id = ${orgId} AND usage_date = ${usageDate}::date
    `);
    await tx.execute(sql`
      UPDATE llm_global_usage SET total_tokens = total_tokens + ${delta}, updated_at = now() WHERE usage_date = ${usageDate}::date
    `);
  });
}

/** `YYYY-MM-DD`, UTC — matches the `date` column's own `mode: 'string'` shape (`@prdm/db`'s `llm_usage`/
 * `llm_global_usage` schema) so callers never have to think about timezone-dependent string formatting. */
export function todayUsageDate(clock: () => Date = () => new Date()): string {
  return clock().toISOString().slice(0, 10);
}
