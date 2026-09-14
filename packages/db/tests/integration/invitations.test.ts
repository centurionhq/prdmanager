/**
 * WO-105 — invitation secrets, `resolve_invitation`, and atomic acceptance/revocation. Runs against the
 * real test Postgres instance so `resolve_invitation` (a real `SECURITY DEFINER` function) and the RLS
 * policies on `invitation_secrets`/`project_invitation_grants` are exercised for real.
 */
import { randomUUID } from 'node:crypto';
import {
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  acceptInvitationAsNewUser,
  acceptInvitationForExistingUser,
  addProjectInvitationGrants,
  createInvitationSecret,
  createTenantDb,
  hashInvitationSecret,
  listProjectInvitationGrants,
  resolveInvitationBySecret,
  revokeInvitation,
} from '@prdm/db';
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

const HOUR_MS = 60 * 60 * 1000;

async function createInvitationFixture(org: { id: string }, inviter: { id: string }, overrides: { email?: string; role?: string } = {}) {
  const id = `invite_${randomUUID()}`;
  const email = overrides.email ?? `${randomUUID()}@example.test`;
  await pg.ownerPool.query(
    `INSERT INTO "invitation" (id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId")
     VALUES ($1, $2, $3, $4, 'pending', now() + interval '7 days', now(), $5)`,
    [id, org.id, email, overrides.role ?? 'member', inviter.id],
  );
  return { id, email };
}

describe('invitations (WO-105)', () => {
  test('resolve_invitation finds the org/invitation/email from a secret hash, and nothing from a wrong one', async () => {
    const org = await createOrganizationFixture(pg);
    const inviter = await createUserFixture(pg);
    const inv = await createInvitationFixture(org, inviter, { email: 'invitee@example.test' });
    const { secret } = await createInvitationSecret(pg.appPool, { invitationId: inv.id, orgId: org.id, expiresAt: new Date(Date.now() + HOUR_MS) });

    const resolved = await resolveInvitationBySecret(pg.appPool, secret);
    expect(resolved).toMatchObject({ orgId: org.id, invitationId: inv.id, email: 'invitee@example.test' });

    expect(await resolveInvitationBySecret(pg.appPool, 'not-the-real-secret')).toBeNull();
  });

  test('an id without the matching secret resolves to nothing (secret required, id alone proves nothing)', async () => {
    const org = await createOrganizationFixture(pg);
    const inviter = await createUserFixture(pg);
    const invA = await createInvitationFixture(org, inviter);
    const invB = await createInvitationFixture(org, inviter);
    const secretA = await createInvitationSecret(pg.appPool, { invitationId: invA.id, orgId: org.id, expiresAt: new Date(Date.now() + HOUR_MS) });
    await createInvitationSecret(pg.appPool, { invitationId: invB.id, orgId: org.id, expiresAt: new Date(Date.now() + HOUR_MS) });

    // Using invB's id together with invA's secret must not resolve to invB.
    const resolved = await resolveInvitationBySecret(pg.appPool, secretA.secret);
    expect(resolved?.invitationId).toBe(invA.id);
    expect(resolved?.invitationId).not.toBe(invB.id);
  });

  test('acceptInvitationAsNewUser creates the user, membership and project grants atomically, and consumes the secret', async () => {
    const org = await createOrganizationFixture(pg);
    const inviter = await createUserFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const inv = await createInvitationFixture(org, inviter, { email: 'newowner@example.test', role: 'owner' });
    const { secret } = await createInvitationSecret(pg.appPool, { invitationId: inv.id, orgId: org.id, expiresAt: new Date(Date.now() + HOUR_MS) });
    await addProjectInvitationGrants(pg.appPool, { invitationId: inv.id, orgId: org.id, grants: [{ projectId: project.id, role: 'admin' }] });

    const resolved = await resolveInvitationBySecret(pg.appPool, secret);
    const grants = await listProjectInvitationGrants(pg.appPool, org.id, inv.id);
    const result = await acceptInvitationAsNewUser(pg.appPool, {
      orgId: resolved!.orgId,
      invitationId: resolved!.invitationId,
      email: resolved!.email,
      name: 'New Owner',
      password: 'correct-horse-battery-staple',
      orgRole: 'owner',
      grants,
    });

    const { rows: userRows } = await pg.ownerPool.query(`SELECT email, "emailVerified" FROM "user" WHERE id = $1`, [result.userId]);
    expect(userRows[0]).toEqual({ email: 'newowner@example.test', emailVerified: true });

    const { rows: memberRows } = await pg.ownerPool.query(`SELECT role FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [
      org.id,
      result.userId,
    ]);
    expect(memberRows).toEqual([{ role: 'owner' }]);

    const orgDb = createTenantDb(pg.appPool).forOrg(org.id);
    expect(await orgDb.forProject(project.id).members.list()).toEqual([{ projectId: project.id, userId: result.userId, orgId: org.id, role: 'admin' }]);

    const { rows: secretRows } = await pg.ownerPool.query(`SELECT consumed_at FROM invitation_secrets WHERE invitation_id = $1`, [inv.id]);
    expect(secretRows[0]!.consumed_at).not.toBeNull();

    const { rows: invitationRows } = await pg.ownerPool.query(`SELECT status FROM "invitation" WHERE id = $1`, [inv.id]);
    expect(invitationRows[0]).toEqual({ status: 'accepted' });
  });

  test('an expired invitation cannot be accepted', async () => {
    const org = await createOrganizationFixture(pg);
    const inviter = await createUserFixture(pg);
    const inv = await createInvitationFixture(org, inviter, { email: 'expired@example.test' });
    const { secret } = await createInvitationSecret(pg.appPool, { invitationId: inv.id, orgId: org.id, expiresAt: new Date(Date.now() - HOUR_MS) });
    const resolved = await resolveInvitationBySecret(pg.appPool, secret);

    await expect(
      acceptInvitationAsNewUser(pg.appPool, {
        orgId: resolved!.orgId,
        invitationId: resolved!.invitationId,
        email: resolved!.email,
        name: 'Late',
        password: 'correct-horse-battery-staple',
        orgRole: 'member',
        grants: [],
      }),
    ).rejects.toBeInstanceOf(InvitationExpiredError);
  });

  test('accepting twice fails the second time (reuse) and a revoked invitation cannot be accepted', async () => {
    const org = await createOrganizationFixture(pg);
    const inviter = await createUserFixture(pg);
    const inv = await createInvitationFixture(org, inviter, { email: 'once@example.test' });
    const { secret } = await createInvitationSecret(pg.appPool, { invitationId: inv.id, orgId: org.id, expiresAt: new Date(Date.now() + HOUR_MS) });

    await acceptInvitationAsNewUser(pg.appPool, {
      orgId: org.id,
      invitationId: inv.id,
      email: 'once@example.test',
      name: 'First',
      password: 'correct-horse-battery-staple',
      orgRole: 'member',
      grants: [],
    });

    await expect(
      acceptInvitationAsNewUser(pg.appPool, {
        orgId: org.id,
        invitationId: inv.id,
        email: 'once@example.test',
        name: 'Second',
        password: 'correct-horse-battery-staple',
        orgRole: 'member',
        grants: [],
      }),
    ).rejects.toBeInstanceOf(InvitationAlreadyAcceptedError);

    const revoked = await createInvitationFixture(org, inviter, { email: 'revoked@example.test' });
    await createInvitationSecret(pg.appPool, { invitationId: revoked.id, orgId: org.id, expiresAt: new Date(Date.now() + HOUR_MS) });
    await revokeInvitation(pg.appPool, { orgId: org.id, invitationId: revoked.id });

    await expect(
      acceptInvitationAsNewUser(pg.appPool, {
        orgId: org.id,
        invitationId: revoked.id,
        email: 'revoked@example.test',
        name: 'Nope',
        password: 'correct-horse-battery-staple',
        orgRole: 'member',
        grants: [],
      }),
    ).rejects.toBeInstanceOf(InvitationAlreadyAcceptedError);
  });

  test('concurrent accepts of the same invitation: exactly one succeeds', async () => {
    const org = await createOrganizationFixture(pg);
    const inviter = await createUserFixture(pg);
    const inv = await createInvitationFixture(org, inviter, { email: 'race@example.test' });
    await createInvitationSecret(pg.appPool, { invitationId: inv.id, orgId: org.id, expiresAt: new Date(Date.now() + HOUR_MS) });

    const attempt = () =>
      acceptInvitationAsNewUser(pg.appPool, {
        orgId: org.id,
        invitationId: inv.id,
        email: 'race@example.test',
        name: 'Racer',
        password: 'correct-horse-battery-staple',
        orgRole: 'member',
        grants: [],
      });

    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);

    const { rows } = await pg.ownerPool.query(`SELECT count(*)::int AS c FROM "user" WHERE email = 'race@example.test'`);
    expect(rows[0]!.c).toBe(1);
  });

  test('acceptInvitationForExistingUser adds membership + grants for an already-existing user', async () => {
    const org = await createOrganizationFixture(pg);
    const inviter = await createUserFixture(pg);
    const existing = await createUserFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const inv = await createInvitationFixture(org, inviter, { email: existing.email, role: 'admin' });
    await createInvitationSecret(pg.appPool, { invitationId: inv.id, orgId: org.id, expiresAt: new Date(Date.now() + HOUR_MS) });
    await addProjectInvitationGrants(pg.appPool, { invitationId: inv.id, orgId: org.id, grants: [{ projectId: project.id, role: 'viewer' }] });
    const grants = await listProjectInvitationGrants(pg.appPool, org.id, inv.id);

    const result = await acceptInvitationForExistingUser(pg.appPool, { orgId: org.id, invitationId: inv.id, userId: existing.id, orgRole: 'admin', grants });

    expect(result.userId).toBe(existing.id);
    const { rows } = await pg.ownerPool.query(`SELECT role FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [org.id, existing.id]);
    expect(rows).toEqual([{ role: 'admin' }]);
  });

  test('hashInvitationSecret is deterministic sha256 and never equal to the secret itself', () => {
    const hash1 = hashInvitationSecret('same-secret');
    const hash2 = hashInvitationSecret('same-secret');
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe('same-secret');
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  test('an invitation not found by resolve_invitation raises InvitationNotFoundError only when accepted directly with a bogus id', async () => {
    const org = await createOrganizationFixture(pg);
    await expect(
      acceptInvitationAsNewUser(pg.appPool, {
        orgId: org.id,
        invitationId: 'nonexistent',
        email: 'nope@example.test',
        name: 'Nope',
        password: 'correct-horse-battery-staple',
        orgRole: 'member',
        grants: [],
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });
});
