import { randomUUID } from 'node:crypto';
import { createPool, withTenantTx, type PgDatabase } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, openTestPg, testPgConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

let pg: PgTestDb;

beforeAll(async () => {
  pg = await openTestPg();
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

async function selectProjectSlugs(tx: PgDatabase): Promise<string[]> {
  const { rows } = await tx.execute<{ slug: string }>(sql`SELECT slug FROM projects ORDER BY slug`);
  return rows.map((row) => row.slug);
}

describe('withTenantTx + RLS on projects/project_members (WO-098)', () => {
  test('rows of org A are invisible under org B', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    await createProjectFixture(pg, { orgId: orgA.id, slug: 'alpha' });
    await createProjectFixture(pg, { orgId: orgB.id, slug: 'beta' });

    await withTenantTx(pg.appPool, orgA.id, async (tx) => {
      expect(await selectProjectSlugs(tx)).toEqual(['alpha']);
    });
    await withTenantTx(pg.appPool, orgB.id, async (tx) => {
      expect(await selectProjectSlugs(tx)).toEqual(['beta']);
    });
  });

  test('no app.org_id set means zero rows', async () => {
    const orgA = await createOrganizationFixture(pg);
    await createProjectFixture(pg, { orgId: orgA.id });

    const { rows } = await pg.appPool.query('SELECT * FROM projects');
    expect(rows).toEqual([]);
  });

  test('inserting a row with a mismatched org_id is rejected by WITH CHECK', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);

    await expect(
      withTenantTx(pg.appPool, orgA.id, async (tx) => {
        await tx.execute(
          sql`INSERT INTO projects (org_id, slug, name, graph_project_id) VALUES (${orgB.id}, 'sneaky', 'Sneaky', 'prj_0123456789abcdef')`,
        );
      }),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/i) } });
  });

  test('a composite FK blocks a project_members row referencing another org project', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: orgA.id });
    const userId = `user_${randomUUID()}`;
    await pg.ownerPool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, 'Test', $2, true, now(), now())`,
      [userId, `${randomUUID()}@example.test`],
    );

    // project A's real id, but claiming it belongs to org B: the composite FK (project_id, org_id) ->
    // projects(id, org_id) has no matching row, since project A's row is (projectA.id, orgA.id).
    await expect(
      withTenantTx(pg.appPool, orgB.id, async (tx) => {
        await tx.execute(
          sql`INSERT INTO project_members (project_id, user_id, org_id, role) VALUES (${projectA.id}, ${userId}, ${orgB.id}, 'admin')`,
        );
      }),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/violates foreign key constraint|row-level security/i) } });
  });

  test('pooled connection reuse does not leak app.org_id across sequential transactions', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    await createProjectFixture(pg, { orgId: orgA.id, slug: 'alpha' });
    await createProjectFixture(pg, { orgId: orgB.id, slug: 'beta' });

    const config = testPgConfig();
    const soloPool = createPool({ connectionString: config.appUrl, maxConnections: 1 });
    try {
      await withTenantTx(soloPool, orgA.id, async (tx) => {
        expect(await selectProjectSlugs(tx)).toEqual(['alpha']);
      });
      // Same (and only) physical connection in the pool, but a fresh transaction with no org_id set:
      // if `set_config(..., true)` had leaked past the first transaction's commit, this would still
      // see org A's row instead of zero.
      const { rows } = await soloPool.query('SELECT * FROM projects');
      expect(rows).toEqual([]);

      await withTenantTx(soloPool, orgB.id, async (tx) => {
        expect(await selectProjectSlugs(tx)).toEqual(['beta']);
      });
    } finally {
      await soloPool.end();
    }
  });
});
