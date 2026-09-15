/**
 * WO-175 — token quota reservation: atomic per-org and global daily caps, reserved before the model is
 * ever called so concurrent turns can't both exceed the quota, plus post-turn reconciliation.
 */
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { reconcileAgentTokens, reserveAgentTokens, todayUsageDate } from '../../src/agent/agent-quota.js';

describe('reserveAgentTokens / reconcileAgentTokens (SDD-009 §Seguridad y costo, WO-175)', () => {
  let pg: PgTestDb;
  const USAGE_DATE = '2026-09-14';

  beforeAll(async () => {
    pg = await openTestPg();
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await pg.close();
  });

  async function readOrgUsage(orgId: string): Promise<{ totalTokens: number; requestCount: number } | null> {
    const usage = await createTenantDb(pg.appPool).forOrg(orgId).agent.llmUsage.find(USAGE_DATE);
    return usage ? { totalTokens: usage.totalTokens, requestCount: usage.requestCount } : null;
  }

  async function readGlobalUsage(): Promise<{ totalTokens: number; requestCount: number }> {
    const { rows } = await pg.ownerPool.query(`SELECT total_tokens, request_count FROM llm_global_usage WHERE usage_date = $1`, [USAGE_DATE]);
    return rows.length > 0 ? { totalTokens: rows[0].total_tokens, requestCount: rows[0].request_count } : { totalTokens: 0, requestCount: 0 };
  }

  test('reserves tokens against both the org and global counters when under both limits', async () => {
    const org = await createOrganizationFixture(pg);
    const result = await reserveAgentTokens(pg.appPool, org.id, 500, { dailyTokensPerOrg: 1000, dailyTokensGlobal: 10_000 }, USAGE_DATE);
    expect(result).toEqual({ ok: true });
    expect(await readOrgUsage(org.id)).toEqual({ totalTokens: 500, requestCount: 1 });
    expect(await readGlobalUsage()).toEqual({ totalTokens: 500, requestCount: 1 });
  });

  test('rejects and reserves nothing once the per-organization daily limit would be exceeded', async () => {
    const org = await createOrganizationFixture(pg);
    await reserveAgentTokens(pg.appPool, org.id, 800, { dailyTokensPerOrg: 1000, dailyTokensGlobal: 10_000 }, USAGE_DATE);

    const second = await reserveAgentTokens(pg.appPool, org.id, 300, { dailyTokensPerOrg: 1000, dailyTokensGlobal: 10_000 }, USAGE_DATE);
    expect(second).toEqual({ ok: false, reason: 'org_quota_exceeded' });
    // Unchanged from the first reservation — the rejected attempt reserved nothing.
    expect(await readOrgUsage(org.id)).toEqual({ totalTokens: 800, requestCount: 1 });
    expect(await readGlobalUsage()).toEqual({ totalTokens: 800, requestCount: 1 });
  });

  test('rejects on the global cap even when the organization has room, and rolls back the org reservation too', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    // Exhaust the (tiny) global budget via org A first.
    await reserveAgentTokens(pg.appPool, orgA.id, 900, { dailyTokensPerOrg: 100_000, dailyTokensGlobal: 1000 }, USAGE_DATE);

    const orgBResult = await reserveAgentTokens(pg.appPool, orgB.id, 200, { dailyTokensPerOrg: 100_000, dailyTokensGlobal: 1000 }, USAGE_DATE);
    expect(orgBResult).toEqual({ ok: false, reason: 'global_quota_exceeded' });
    // Org B's own counter must never show a reservation that was rolled back.
    expect(await readOrgUsage(orgB.id)).toBeNull();
    expect(await readGlobalUsage()).toEqual({ totalTokens: 900, requestCount: 1 });
  });

  test('concurrent reservations for the same organization never together exceed the limit', async () => {
    const org = await createOrganizationFixture(pg);
    const limits = { dailyTokensPerOrg: 100, dailyTokensGlobal: 1_000_000 };

    const results = await Promise.all([
      reserveAgentTokens(pg.appPool, org.id, 60, limits, USAGE_DATE),
      reserveAgentTokens(pg.appPool, org.id, 60, limits, USAGE_DATE),
      reserveAgentTokens(pg.appPool, org.id, 60, limits, USAGE_DATE),
    ]);

    const succeeded = results.filter((r) => r.ok);
    expect(succeeded).toHaveLength(1); // 60*2 > 100, so only one of the three can ever fit
    const usage = await readOrgUsage(org.id);
    expect(usage?.totalTokens).toBe(60);
    expect(usage?.totalTokens).toBeLessThanOrEqual(limits.dailyTokensPerOrg);
  });

  test('a single reservation larger than the daily limit is rejected outright, even as the very first request of the day', async () => {
    const org = await createOrganizationFixture(pg);
    const result = await reserveAgentTokens(pg.appPool, org.id, 5000, { dailyTokensPerOrg: 1000, dailyTokensGlobal: 10_000 }, USAGE_DATE);
    expect(result).toEqual({ ok: false, reason: 'org_quota_exceeded' });
    expect(await readOrgUsage(org.id)).toBeNull();
  });

  test('reconcileAgentTokens credits back unused reserved tokens', async () => {
    const org = await createOrganizationFixture(pg);
    await reserveAgentTokens(pg.appPool, org.id, 500, { dailyTokensPerOrg: 10_000, dailyTokensGlobal: 100_000 }, USAGE_DATE);

    await reconcileAgentTokens(pg.appPool, org.id, 500, 120, USAGE_DATE); // only 120 of the reserved 500 were actually used
    expect((await readOrgUsage(org.id))?.totalTokens).toBe(120);
    expect((await readGlobalUsage()).totalTokens).toBe(120);
  });

  test('todayUsageDate formats a given clock as YYYY-MM-DD', () => {
    expect(todayUsageDate(() => new Date('2026-09-14T23:59:59.000Z'))).toBe('2026-09-14');
  });
});
