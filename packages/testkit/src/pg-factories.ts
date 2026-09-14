import { randomUUID } from 'node:crypto';
import type { PgTestDb } from './pg.js';

/**
 * Backed by real inserts against the tables SDD-006 defines. `createOrganizationFixture` and
 * `createUserFixture` insert directly through `pg.ownerPool` (a superuser, so it bypasses RLS
 * entirely) into better-auth's own tables — fine for tests per WO-092/WO-098, since seeding fixture
 * users/orgs isn't itself the thing under test. `createProjectFixture` (WO-098) does the same for
 * `projects`, since most isolation tests need to set up rows in *two* different orgs from one caller.
 */

export interface OrganizationFixture {
  id: string;
  name: string;
  slug: string;
}

export interface UserFixture {
  id: string;
  email: string;
  /** `dev:<handle>` must satisfy `ACTOR_PATTERN` from `@prdm/core` (SDD-006 §Modelo de datos). */
  handle: string;
}

export interface ProjectFixture {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  graphProjectId: string;
}

export async function createOrganizationFixture(pg: PgTestDb, overrides: Partial<OrganizationFixture> = {}): Promise<OrganizationFixture> {
  const suffix = randomUUID();
  const fixture: OrganizationFixture = {
    id: overrides.id ?? `org_${suffix}`,
    name: overrides.name ?? `Test Org ${suffix}`,
    slug: overrides.slug ?? `test-org-${suffix}`,
  };
  await pg.ownerPool.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, $2, $3, now())`, [
    fixture.id,
    fixture.name,
    fixture.slug,
  ]);
  return fixture;
}

export async function createUserFixture(pg: PgTestDb, overrides: Partial<UserFixture> = {}): Promise<UserFixture> {
  const suffix = randomUUID();
  const fixture: UserFixture = {
    id: overrides.id ?? `user_${suffix}`,
    email: overrides.email ?? `${suffix}@example.test`,
    handle: overrides.handle ?? suffix,
  };
  await pg.ownerPool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())`,
    [fixture.id, fixture.email, fixture.email],
  );
  await pg.ownerPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, $2)`, [fixture.id, fixture.handle]);
  return fixture;
}

/** `orgId` is required (no server-side default makes sense for a project without a tenant). */
export async function createProjectFixture(
  pg: PgTestDb,
  overrides: Partial<ProjectFixture> & { orgId: string },
): Promise<ProjectFixture> {
  const suffix = randomUUID();
  const fixture: ProjectFixture = {
    id: overrides.id ?? randomUUID(),
    orgId: overrides.orgId,
    name: overrides.name ?? `Test Project ${suffix}`,
    slug: overrides.slug ?? `test-project-${suffix}`,
    graphProjectId: overrides.graphProjectId ?? `prj_${suffix.replace(/-/g, '').slice(0, 16)}`,
  };
  await pg.ownerPool.query(
    `INSERT INTO "projects" (id, org_id, slug, name, graph_project_id) VALUES ($1, $2, $3, $4, $5)`,
    [fixture.id, fixture.orgId, fixture.slug, fixture.name, fixture.graphProjectId],
  );
  return fixture;
}
