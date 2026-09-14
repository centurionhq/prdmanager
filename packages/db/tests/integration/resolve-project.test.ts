/**
 * `resolve_project`/`resolve_graph_project` (SDD-006 §Aislamiento por capas, point 3; WO-097): the only
 * way `prdm_app` can learn which organization a project belongs to before `app.org_id` is set. Runs
 * against the real test Postgres instance so the `SECURITY DEFINER` functions and the RLS policy on
 * `projects` are exercised for real, not mocked.
 */
import { createTenantDb, resolveProjectByGraphProjectId, resolveProjectById } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
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

describe('resolve_project / resolve_graph_project (WO-097)', () => {
  test('resolve_project finds only org_id for a known project uuid, and nothing for an unknown one', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    const resolved = await resolveProjectById(pg.appPool, project.id);
    expect(resolved).toEqual({ orgId: org.id });

    const unknown = await resolveProjectById(pg.appPool, '00000000-0000-0000-0000-000000000000');
    expect(unknown).toBeNull();
  });

  test('resolve_project returns null for a syntactically invalid uuid instead of throwing', async () => {
    await expect(resolveProjectById(pg.appPool, 'not-a-uuid')).resolves.toBeNull();
  });

  test('resolve_graph_project finds org_id and the internal uuid from a graph_project_id, and nothing for an unknown one', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    const resolved = await resolveProjectByGraphProjectId(pg.appPool, project.graphProjectId);
    expect(resolved).toEqual({ orgId: org.id, projectId: project.id });

    expect(await resolveProjectByGraphProjectId(pg.appPool, 'prj_0000000000000000')).toBeNull();
  });

  test('resolvers leak nothing beyond their declared columns (no name/slug/settings leaks through)', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id, name: 'canary-project-name', slug: 'canary-project-slug' });

    const byId = await resolveProjectById(pg.appPool, project.id);
    expect(byId).toEqual({ orgId: org.id });
    expect(Object.keys(byId ?? {}).sort()).toEqual(['orgId']);

    const byGraphId = await resolveProjectByGraphProjectId(pg.appPool, project.graphProjectId);
    expect(byGraphId).toEqual({ orgId: org.id, projectId: project.id });
    expect(Object.keys(byGraphId ?? {}).sort()).toEqual(['orgId', 'projectId']);
  });

  test('prdm_app without app.org_id set can resolve a project but cannot read projects directly', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    // No withTenantTx here: app.org_id is never set on pg.appPool's connection for this query.
    const resolved = await resolveProjectById(pg.appPool, project.id);
    expect(resolved).toEqual({ orgId: org.id });

    // The same unscoped connection cannot see the row directly — RLS with no app.org_id set yields
    // zero rows (NULLIF(current_setting('app.org_id', true), '') is NULL, and org_id = NULL is never
    // true), which is exactly why resolve_project (SECURITY DEFINER, bypassing RLS by design) exists.
    const { rows } = await pg.appPool.query('SELECT * FROM "projects" WHERE id = $1', [project.id]);
    expect(rows).toEqual([]);
  });

  test('a project resolved from one org cannot be read through another org\'s tenant scope', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: orgA.id });

    const resolved = await resolveProjectById(pg.appPool, project.id);
    expect(resolved).toEqual({ orgId: orgA.id });

    // Even knowing the uuid and the (correct) resolved org, opening a tenant scope for the *wrong* org
    // must not see it.
    const foundInWrongOrg = await createTenantDb(pg.appPool).forOrg(orgB.id).forProject(project.id).get();
    expect(foundInWrongOrg).toBeNull();

    const foundInRightOrg = await createTenantDb(pg.appPool).forOrg(orgA.id).forProject(project.id).get();
    expect(foundInRightOrg?.id).toBe(project.id);
  });
});
