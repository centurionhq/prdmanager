import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, createUserFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
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

describe('createTenantDb(pool).forOrg(orgId) (WO-100)', () => {
  test('projects.create + list + findBySlug/findByGraphProjectId round-trip within one org', async () => {
    const org = await createOrganizationFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    const created = await db.projects.create({ slug: 'roadmap', name: 'Roadmap', graphProjectId: 'prj_0011223344556677' });
    expect(created.orgId).toBe(org.id);

    expect(await db.projects.list()).toEqual([created]);
    expect(await db.projects.findBySlug('roadmap')).toEqual(created);
    expect(await db.projects.findByGraphProjectId('prj_0011223344556677')).toEqual(created);
    expect(await db.projects.findBySlug('nope')).toBeNull();
  });

  test('a project from another org is invisible: findById/get resolve to null, not an error', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: orgA.id });

    const dbAsOrgB = createTenantDb(pg.appPool).forOrg(orgB.id);
    await expect(dbAsOrgB.projects.findById(projectA.id)).resolves.toBeNull();
    await expect(dbAsOrgB.forProject(projectA.id).get()).resolves.toBeNull();
    await expect(dbAsOrgB.projects.list()).resolves.toEqual([]);
  });

  test('forProject(projectId).members: upsert, list, findForUser and remove, scoped to that project', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const member = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);
    const scope = db.forProject(project.id);

    const upserted = await scope.members.upsert({ userId: member.id, role: 'editor' });
    expect(upserted).toMatchObject({ projectId: project.id, orgId: org.id, userId: member.id, role: 'editor' });

    expect(await scope.members.list()).toEqual([
      { projectId: project.id, orgId: org.id, userId: member.id, role: 'editor', email: member.email, name: member.email },
    ]);
    expect(await scope.members.findForUser(member.id)).toEqual(upserted);
    expect(await scope.members.findForUser('nonexistent-user')).toBeNull();
    expect(await db.members.listForUser(member.id)).toEqual([upserted]);

    const promoted = await scope.members.upsert({ userId: member.id, role: 'admin' });
    expect(promoted.role).toBe('admin');
    expect(await scope.members.list()).toMatchObject([{ role: 'admin' }]);

    await scope.members.remove(member.id);
    expect(await scope.members.list()).toEqual([]);
  });

  test('projects.listForUser only returns projects the user has a project_members row in', async () => {
    const org = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: org.id, slug: 'project-a' });
    const projectB = await createProjectFixture(pg, { orgId: org.id, slug: 'project-b' });
    const member = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    expect(await db.projects.listForUser(member.id)).toEqual([]);

    await db.forProject(projectA.id).members.upsert({ userId: member.id, role: 'viewer' });
    const visible = await db.projects.listForUser(member.id);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ id: projectA.id, slug: projectA.slug });
    expect(visible.some((p) => p.id === projectB.id)).toBe(false);
  });

  test("a member of another org's project never shows up in this org's scope", async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: orgA.id });
    const user = await createUserFixture(pg);

    await createTenantDb(pg.appPool).forOrg(orgA.id).forProject(projectA.id).members.upsert({ userId: user.id, role: 'viewer' });

    const dbAsOrgB = createTenantDb(pg.appPool).forOrg(orgB.id);
    await expect(dbAsOrgB.members.listForUser(user.id)).resolves.toEqual([]);
    await expect(dbAsOrgB.forProject(projectA.id).members.list()).resolves.toEqual([]);
  });
});
