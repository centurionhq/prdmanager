/**
 * Fixture seeding for the isolation suite (SDD-006 §Aislamiento por capas point 4, WO-111): org A (with
 * projects A1 and A2), org B, and users covering every credential the route table's probes need — plus
 * a unique canary string planted into every org-A-owned text field this harness can reach (org name,
 * project name/settings, an invitation's email, a personal token's name, and an audit log entry's
 * metadata).
 */
import { randomUUID } from 'node:crypto';
import { createCiToken, createPersonalToken, createTenantDb } from '@prdm/db';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, type PgTestDb } from '@prdm/testkit';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import type { BuiltApp, IsolationFixtures } from './types.js';

const PASSWORD = 'correct-horse-battery-staple';
const DAY_MS = 24 * 60 * 60 * 1000;

export const ISOLATION_TEST_ENV = buildTestServerEnv();
export const ISOLATION_AUTH_HOST = { host: new URL(ISOLATION_TEST_ENV.publicUrl).host };
export const ISOLATION_ORIGIN = ISOLATION_TEST_ENV.publicUrl;

export async function signIn(app: BuiltApp, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    payload: { email, password: PASSWORD },
    headers: ISOLATION_AUTH_HOST,
  });
  const cookie = res.headers['set-cookie'];
  const value = Array.isArray(cookie) ? cookie[0] : cookie;
  if (!value) throw new Error('isolation fixtures: sign-in did not set a session cookie');
  return value.split(';')[0]!;
}

async function insertInvitation(pg: PgTestDb, orgId: string, inviterId: string, email: string): Promise<{ id: string; email: string }> {
  const id = `invite_${randomUUID()}`;
  await pg.ownerPool.query(
    `INSERT INTO "invitation" (id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId")
     VALUES ($1, $2, $3, 'member', 'pending', now() + interval '7 days', now(), $4)`,
    [id, orgId, email, inviterId],
  );
  return { id, email };
}

export async function buildIsolationFixtures(app: BuiltApp, pg: PgTestDb): Promise<IsolationFixtures> {
  const canary = `CANARY-${randomUUID()}`;

  const orgAOwner = await seedUser(ISOLATION_TEST_ENV, pg.appPool, PASSWORD);
  const orgAOutsider = await seedUser(ISOLATION_TEST_ENV, pg.appPool, PASSWORD);
  const orgBOwner = await seedUser(ISOLATION_TEST_ENV, pg.appPool, PASSWORD);

  const orgA = await createOrganizationFixture(pg, { name: `Org A ${canary}` });
  const orgB = await createOrganizationFixture(pg);
  await createMemberFixture(pg, { organizationId: orgA.id, userId: orgAOwner.id, role: 'owner' });
  await createMemberFixture(pg, { organizationId: orgA.id, userId: orgAOutsider.id, role: 'member' });
  await createMemberFixture(pg, { organizationId: orgB.id, userId: orgBOwner.id, role: 'owner' });

  const projectA1 = await createProjectFixture(pg, { orgId: orgA.id, name: `Project A1 ${canary}` });
  const projectA2 = await createProjectFixture(pg, { orgId: orgA.id });
  // `projectA2` (not `projectA1`) is where the outsider gets a row — they belong to org A, just not to
  // A1, the "same org, other project" caller SDD-006 §Aislamiento entre proyectos describes.
  await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [
    projectA2.id,
    orgAOutsider.id,
    orgA.id,
  ]);

  // Canary in a project's own settings (the `default_branch` free-text field — SDD-006 §Modelo de
  // datos lists it as part of the validated settings subset).
  await pg.ownerPool.query(`UPDATE "projects" SET settings = $1 WHERE id = $2`, [
    JSON.stringify({ default_branch: `refs/heads/${canary}` }),
    projectA1.id,
  ]);

  const invitationA = await insertInvitation(pg, orgA.id, orgAOwner.id, `${canary}@example.test`);

  const personalToken = await createPersonalToken(pg.appPool, {
    orgId: orgA.id,
    userId: orgAOwner.id,
    name: `token ${canary}`,
    scopes: ['governance:read'],
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
  });

  const ciToken = await createCiToken(pg.appPool, {
    orgId: orgA.id,
    projectIds: [projectA1.id],
    name: `ci-token ${canary}`,
    scopes: ['governance:read'],
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    createdBy: orgAOwner.id,
  });

  await createTenantDb(pg.appPool)
    .forOrg(orgA.id)
    .auditLog.record({
      projectId: projectA1.id,
      actorType: 'user',
      actorId: orgAOwner.id,
      action: 'isolation_fixture.seeded',
      target: projectA1.id,
      metadata: { note: canary },
    });

  const orgAOwnerSessionCookie = await signIn(app, orgAOwner.email);
  const orgAOutsiderSessionCookie = await signIn(app, orgAOutsider.email);
  const orgBOwnerSessionCookie = await signIn(app, orgBOwner.email);

  const orgBToken = await createPersonalToken(pg.appPool, {
    orgId: orgB.id,
    userId: orgBOwner.id,
    name: 'org B bearer probe token',
    scopes: ['governance:read'],
    expiresAt: new Date(Date.now() + DAY_MS),
  });

  return {
    canary,
    orgA: { id: orgA.id, slug: orgA.slug, name: orgA.name },
    orgB: { id: orgB.id, slug: orgB.slug, name: orgB.name },
    projectA1: { id: projectA1.id, slug: projectA1.slug, name: projectA1.name, graphProjectId: projectA1.graphProjectId },
    projectA2: { id: projectA2.id, slug: projectA2.slug, name: projectA2.name },
    invitationA,
    personalTokenA: { id: personalToken.record.id },
    ciTokenA1: { id: ciToken.record.id },
    orgAOwnerUserId: orgAOwner.id,
    orgAOutsiderSessionCookie,
    orgAOwnerSessionCookie,
    orgBOwnerSessionCookie,
    orgBOwnerBearerSecret: orgBToken.token,
  };
}

/** Re-exported so per-route probe factories that need a fresh CSRF handshake (mutating routes) don't
 * each re-import the same helper under a different relative path. */
export { mutationHeaders };
