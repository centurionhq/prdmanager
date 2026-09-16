/**
 * WO-343 — `POST .../invitations/:invitationId/resend`: rotates the one-time secret, extends
 * `expiresAt`, resends the email, audits, and is gated the same as creating an invitation
 * (owner/admin only). Also covers the new `lastActiveAt`/`createdByName` DTO fields.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('POST .../invitations/:invitationId/resend (WO-343)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const PASSWORD = 'correct-horse-battery-staple';
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    const config = testConfig(tmpRoot);
    neo4j = Neo4jGraphDatabase.connect(config.neo4j);
    await neo4j.verify();
    await neo4j.migrate();
    env = buildTestServerEnv({ neo4j: config.neo4j });
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await neo4j.close();
    removeDir(tmpRoot);
    await pg.close();
  });

  function buildApp() {
    return buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, neo4j });
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST() });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  test('member is forbidden; owner rotates the secret, extends expiresAt and it is audited', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const plainMember = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: plainMember.id, role: 'member' });
    const ownerCookie = await signIn(app, owner.email);
    const memberCookie = await signIn(app, plainMember.email);

    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { email: 'invitee@example.test', role: 'member', projectGrants: [] },
    });
    expect(created.statusCode).toBe(200);
    const invitationId = created.json().invitationId as string;
    const { rows: before } = await pg.ownerPool.query(`SELECT "expiresAt" FROM "invitation" WHERE id = $1`, [invitationId]);
    const { rows: secretBefore } = await pg.ownerPool.query(`SELECT secret_hash FROM "invitation_secrets" WHERE invitation_id = $1`, [invitationId]);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations/${invitationId}/resend`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, memberCookie),
    });
    expect(forbidden.statusCode).toBe(403);

    const resent = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations/${invitationId}/resend`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
    });
    expect(resent.statusCode).toBe(200);
    expect(resent.json()).toEqual({ invitationId });

    const { rows: after } = await pg.ownerPool.query(`SELECT "expiresAt" FROM "invitation" WHERE id = $1`, [invitationId]);
    expect(new Date(after[0].expiresAt).getTime()).toBeGreaterThan(new Date(before[0].expiresAt).getTime());

    const { rows: secretAfter } = await pg.ownerPool.query(`SELECT secret_hash, consumed_at FROM "invitation_secrets" WHERE invitation_id = $1`, [invitationId]);
    expect(secretAfter).toHaveLength(1);
    expect(secretAfter[0].consumed_at).toBeNull();
    expect(secretAfter[0].secret_hash).not.toBe(secretBefore[0].secret_hash);

    const { rows: auditRows } = await pg.ownerPool.query(`SELECT action FROM audit_log WHERE org_id = $1 AND action = 'organization.invitation.resent'`, [org.id]);
    expect(auditRows).toHaveLength(1);

    await app.close();
  });

  test('404s a revoked invitation with 409 conflict instead of silently reviving it', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const ownerCookie = await signIn(app, owner.email);

    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { email: 'invitee2@example.test', role: 'member', projectGrants: [] },
    });
    const invitationId = created.json().invitationId as string;

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations/${invitationId}/revoke`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations/${invitationId}/resend`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });

  test('organization and project member listings include lastActiveAt for a signed-in user', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const ownerCookie = await signIn(app, owner.email);

    const orgMembers = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/members`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(orgMembers.statusCode).toBe(200);
    expect(orgMembers.json().members[0].lastActiveAt).not.toBeNull();

    const projectMembers = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/members`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(projectMembers.statusCode).toBe(200);
    expect(projectMembers.json().members).toEqual([]);

    await app.close();
  });

  test('CI token listing includes createdByName', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const ownerCookie = await signIn(app, owner.email);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { name: 'ci token', scopes: ['reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const tokens = res.json().tokens as { createdByName: string | null }[];
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.createdByName).toBe('Test User');

    await app.close();
  });
});
