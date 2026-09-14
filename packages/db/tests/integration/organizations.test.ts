/**
 * WO-104 — organization membership queries and role mutations (SDD-006 §Permisos): last-owner and
 * admin-vs-owner rules, enforced atomically inside `packages/db/src/organizations.ts`.
 */
import {
  MembershipNotFoundError,
  OrgRoleRuleError,
  findMembership,
  findOrganizationBySlug,
  listOrganizationMembers,
  listOrganizationsForUser,
  removeOrganizationMember,
  setMemberRole,
} from '@prdm/db';
import { createMemberFixture, createOrganizationFixture, createUserFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
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

describe('organization membership (WO-104)', () => {
  test('listOrganizationsForUser returns every org a user belongs to, with role', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    await createMemberFixture(pg, { organizationId: orgA.id, userId: user.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: orgB.id, userId: user.id, role: 'member' });

    const orgs = await listOrganizationsForUser(pg.appPool, user.id);

    expect(orgs).toHaveLength(2);
    expect(orgs).toEqual(
      expect.arrayContaining([
        { organizationId: orgA.id, slug: orgA.slug, name: orgA.name, role: 'owner' },
        { organizationId: orgB.id, slug: orgB.slug, name: orgB.name, role: 'member' },
      ]),
    );
  });

  test('findOrganizationBySlug and findMembership resolve to null for the wrong org/user', async () => {
    expect(await findOrganizationBySlug(pg.appPool, 'nope')).toBeNull();
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    expect(await findMembership(pg.appPool, org.id, user.id)).toBeNull();
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'admin' });
    expect(await findMembership(pg.appPool, org.id, user.id)).toEqual({ role: 'admin' });
  });

  test('listOrganizationMembers joins email/name from the user table', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'owner' });

    const members = await listOrganizationMembers(pg.appPool, org.id);

    expect(members).toEqual([{ userId: user.id, email: user.email, name: user.email, role: 'owner' }]);
  });

  test('an owner can promote a member to admin', async () => {
    const org = await createOrganizationFixture(pg);
    const owner = await createUserFixture(pg);
    const target = await createUserFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: target.id, role: 'member' });

    await setMemberRole(pg.appPool, org.id, 'owner', target.id, 'admin');

    expect(await findMembership(pg.appPool, org.id, target.id)).toEqual({ role: 'admin' });
  });

  test('an admin cannot grant owner, remove an owner, or demote an owner', async () => {
    const org = await createOrganizationFixture(pg);
    const admin = await createUserFixture(pg);
    const owner = await createUserFixture(pg);
    const member = await createUserFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: admin.id, role: 'admin' });
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });

    await expect(setMemberRole(pg.appPool, org.id, 'admin', member.id, 'owner')).rejects.toBeInstanceOf(OrgRoleRuleError);
    await expect(setMemberRole(pg.appPool, org.id, 'admin', owner.id, 'member')).rejects.toBeInstanceOf(OrgRoleRuleError);
    await expect(removeOrganizationMember(pg.appPool, org.id, 'admin', owner.id)).rejects.toBeInstanceOf(OrgRoleRuleError);

    // Untouched.
    expect(await findMembership(pg.appPool, org.id, owner.id)).toEqual({ role: 'owner' });
  });

  test('the last owner cannot be demoted or removed', async () => {
    const org = await createOrganizationFixture(pg);
    const onlyOwner = await createUserFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: onlyOwner.id, role: 'owner' });

    await expect(setMemberRole(pg.appPool, org.id, 'owner', onlyOwner.id, 'admin')).rejects.toBeInstanceOf(OrgRoleRuleError);
    await expect(removeOrganizationMember(pg.appPool, org.id, 'owner', onlyOwner.id)).rejects.toBeInstanceOf(OrgRoleRuleError);
    expect(await findMembership(pg.appPool, org.id, onlyOwner.id)).toEqual({ role: 'owner' });
  });

  test('a second owner can be demoted or removed (not the last one)', async () => {
    const org = await createOrganizationFixture(pg);
    const ownerA = await createUserFixture(pg);
    const ownerB = await createUserFixture(pg);
    const ownerC = await createUserFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: ownerA.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: ownerB.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: ownerC.id, role: 'owner' });

    await setMemberRole(pg.appPool, org.id, 'owner', ownerB.id, 'admin');
    expect(await findMembership(pg.appPool, org.id, ownerB.id)).toEqual({ role: 'admin' });

    await removeOrganizationMember(pg.appPool, org.id, 'owner', ownerA.id);
    expect(await findMembership(pg.appPool, org.id, ownerA.id)).toBeNull();
    expect(await findMembership(pg.appPool, org.id, ownerC.id)).toEqual({ role: 'owner' });
  });

  test('mutating a non-member throws MembershipNotFoundError', async () => {
    const org = await createOrganizationFixture(pg);
    const owner = await createUserFixture(pg);
    const stranger = await createUserFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });

    await expect(setMemberRole(pg.appPool, org.id, 'owner', stranger.id, 'admin')).rejects.toBeInstanceOf(MembershipNotFoundError);
    await expect(removeOrganizationMember(pg.appPool, org.id, 'owner', stranger.id)).rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  test('concurrent removal of two different owners leaves at least one owner (last-owner race)', async () => {
    const org = await createOrganizationFixture(pg);
    const ownerA = await createUserFixture(pg);
    const ownerB = await createUserFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: ownerA.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: ownerB.id, role: 'owner' });

    const results = await Promise.allSettled([
      removeOrganizationMember(pg.appPool, org.id, 'owner', ownerA.id),
      removeOrganizationMember(pg.appPool, org.id, 'owner', ownerB.id),
    ]);

    const remaining = await listOrganizationMembers(pg.appPool, org.id);
    const owners = remaining.filter((m) => m.role === 'owner');
    expect(owners.length).toBeGreaterThanOrEqual(1);
    // Exactly one of the two concurrent removals must have failed with the last-owner rule.
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});
