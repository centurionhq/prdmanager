/**
 * WO-109 — `api_tokens`, `resolve_token`, checksum/format validation, TTL enforcement and
 * `last_used_at` throttling. Runs against the real test Postgres instance so `resolve_token` (a real
 * `SECURITY DEFINER` function) and RLS on `api_tokens` are exercised for real.
 */
import {
  InvalidScopeError,
  ProjectNotInOrgError,
  TokenTtlTooLongError,
  createCiToken,
  createPersonalToken,
  findTokenById,
  hashTokenSecret,
  listCiTokensForProject,
  listPersonalTokens,
  parseTokenString,
  resolveTokenBySecret,
  revokeToken,
  revokeUserTokensForOrg,
  revokeUserTokensForProject,
  touchTokenLastUsed,
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe('api_tokens (WO-109)', () => {
  test('createPersonalToken returns the full secret once and parseTokenString/resolveTokenBySecret round-trip it', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const now = new Date('2026-01-01T00:00:00Z');

    const created = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'laptop',
      scopes: ['governance:read'],
      expiresAt: new Date(now.getTime() + 30 * DAY_MS),
      now,
    });

    expect(created.token).toMatch(/^prdm_pat_[0-9a-f]{16}[0-9]{2}\.[A-Za-z0-9_-]{32,64}$/);

    const parsed = parseTokenString(created.token);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('personal');

    const resolved = await resolveTokenBySecret(pg.appPool, parsed!.secret);
    expect(resolved).toMatchObject({ id: created.record.id, orgId: org.id, kind: 'personal', userId: user.id, scopes: ['governance:read'] });
  });

  test('a corrupted prefix checksum is rejected before any DB lookup', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const created = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'laptop',
      scopes: ['governance:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
    });

    // Flip one hex digit of the random id, corrupting the checksum without touching the secret.
    const corrupted = created.token.replace(/^(prdm_pat_)([0-9a-f])/, (_m, p, d: string) => `${p}${d === '0' ? '1' : '0'}`);
    expect(parseTokenString(corrupted)).toBeNull();
  });

  test('an unrecognized secret hash resolves to nothing', async () => {
    expect(await resolveTokenBySecret(pg.appPool, 'not-a-real-secret')).toBeNull();
  });

  test('createPersonalToken rejects an expiresAt beyond 90 days from now', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    await expect(
      createPersonalToken(pg.appPool, {
        orgId: org.id,
        userId: user.id,
        name: 'laptop',
        scopes: ['governance:read'],
        expiresAt: new Date(Date.now() + 91 * DAY_MS),
      }),
    ).rejects.toThrow(TokenTtlTooLongError);
  });

  test('createPersonalToken rejects reports:baseline (CI-only scope)', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    await expect(
      createPersonalToken(pg.appPool, {
        orgId: org.id,
        userId: user.id,
        name: 'laptop',
        scopes: ['reports:baseline' as never],
        expiresAt: new Date(Date.now() + DAY_MS),
      }),
    ).rejects.toThrow(InvalidScopeError);
  });

  test('createCiToken rejects mcp:read/mcp:write/import:write (personal-only scopes)', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    await expect(
      createCiToken(pg.appPool, {
        orgId: org.id,
        projectIds: [project.id],
        name: 'ci',
        scopes: ['mcp:read' as never],
        expiresAt: new Date(Date.now() + DAY_MS),
        createdBy: user.id,
      }),
    ).rejects.toThrow(InvalidScopeError);
  });

  test('createCiToken rejects a project id that belongs to another organization', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const projectB = await createProjectFixture(pg, { orgId: orgB.id });
    await expect(
      createCiToken(pg.appPool, {
        orgId: orgA.id,
        projectIds: [projectB.id],
        name: 'ci',
        scopes: ['governance:read'],
        expiresAt: new Date(Date.now() + DAY_MS),
        createdBy: user.id,
      }),
    ).rejects.toThrow(ProjectNotInOrgError);
  });

  test('createPersonalToken accepts an optional project_ids scope, validated to belong to the org (SDD-010, WO-185)', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    const created = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'scoped mcp token',
      scopes: ['mcp:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
      projectIds: [project.id],
    });
    expect(created.record.projectIds).toEqual([project.id]);

    const resolved = await resolveTokenBySecret(pg.appPool, created.token.split('.')[1]!);
    expect(resolved?.projectIds).toEqual([project.id]);
  });

  test('createPersonalToken rejects a project id from another organization', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const projectB = await createProjectFixture(pg, { orgId: orgB.id });

    await expect(
      createPersonalToken(pg.appPool, {
        orgId: orgA.id,
        userId: user.id,
        name: 'scoped',
        scopes: ['mcp:read'],
        expiresAt: new Date(Date.now() + DAY_MS),
        projectIds: [projectB.id],
      }),
    ).rejects.toThrow(ProjectNotInOrgError);
  });

  test('listPersonalTokens/listCiTokensForProject never include secret_hash and revokeToken is idempotent', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const personal = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'laptop',
      scopes: ['governance:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    const ci = await createCiToken(pg.appPool, {
      orgId: org.id,
      projectIds: [project.id],
      name: 'ci',
      scopes: ['reports:write'],
      expiresAt: new Date(Date.now() + DAY_MS),
      createdBy: user.id,
    });

    const personalList = await listPersonalTokens(pg.appPool, org.id, user.id);
    expect(personalList).toHaveLength(1);
    expect(personalList[0]).not.toHaveProperty('secretHash');
    expect(personalList[0]).not.toHaveProperty('secret_hash');

    const ciList = await listCiTokensForProject(pg.appPool, org.id, project.id);
    expect(ciList).toHaveLength(1);
    expect(ciList[0]!.id).toBe(ci.record.id);

    await revokeToken(pg.appPool, { orgId: org.id, tokenId: personal.record.id });
    let refreshed = await findTokenById(pg.appPool, org.id, personal.record.id);
    expect(refreshed!.revokedAt).not.toBeNull();

    // Revoking twice is a no-op, not an error, and doesn't move the revokedAt timestamp forward.
    const firstRevokedAt = refreshed!.revokedAt;
    await revokeToken(pg.appPool, { orgId: org.id, tokenId: personal.record.id, now: new Date(Date.now() + DAY_MS) });
    refreshed = await findTokenById(pg.appPool, org.id, personal.record.id);
    expect(refreshed!.revokedAt).toEqual(firstRevokedAt);
  });

  test('touchTokenLastUsed writes at most once per minute', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const created = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'laptop',
      scopes: ['governance:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
    });

    const t0 = new Date('2026-01-01T00:00:00Z');
    await touchTokenLastUsed(pg.appPool, { orgId: org.id, tokenId: created.record.id, now: t0 });
    let row = await findTokenById(pg.appPool, org.id, created.record.id);
    expect(row!.lastUsedAt).toEqual(t0);

    // 30 seconds later: within the 1-minute throttle window, so lastUsedAt does not move.
    const t1 = new Date(t0.getTime() + 30_000);
    await touchTokenLastUsed(pg.appPool, { orgId: org.id, tokenId: created.record.id, now: t1 });
    row = await findTokenById(pg.appPool, org.id, created.record.id);
    expect(row!.lastUsedAt).toEqual(t0);

    // 61 seconds after t0: past the throttle window, so it does move.
    const t2 = new Date(t0.getTime() + 61_000);
    await touchTokenLastUsed(pg.appPool, { orgId: org.id, tokenId: created.record.id, now: t2 });
    row = await findTokenById(pg.appPool, org.id, created.record.id);
    expect(row!.lastUsedAt).toEqual(t2);
  });

  test('hashTokenSecret is deterministic sha256 hex', () => {
    expect(hashTokenSecret('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('revokeUserTokensForOrg revokes every personal token the user holds in the org, scoped or not (WO-257)', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const otherUser = await createUserFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    const unscoped = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'unscoped',
      scopes: ['mcp:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    const scoped = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'scoped',
      scopes: ['mcp:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
      projectIds: [project.id],
    });
    const untouched = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: otherUser.id,
      name: 'someone else entirely',
      scopes: ['mcp:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
    });

    await revokeUserTokensForOrg(pg.appPool, { orgId: org.id, userId: user.id });

    const revokedUnscoped = await findTokenById(pg.appPool, org.id, unscoped.record.id);
    const revokedScoped = await findTokenById(pg.appPool, org.id, scoped.record.id);
    const stillLiveOtherUser = await findTokenById(pg.appPool, org.id, untouched.record.id);
    expect(revokedUnscoped!.revokedAt).not.toBeNull();
    expect(revokedScoped!.revokedAt).not.toBeNull();
    expect(stillLiveOtherUser!.revokedAt).toBeNull();
  });

  test('revokeUserTokensForProject only revokes tokens explicitly scoped to that project, leaving an unscoped token alone (WO-257)', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const removedProject = await createProjectFixture(pg, { orgId: org.id });
    const otherProject = await createProjectFixture(pg, { orgId: org.id });

    const scopedToRemoved = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'scoped to removed project',
      scopes: ['mcp:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
      projectIds: [removedProject.id],
    });
    const scopedToOther = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'scoped to a different project',
      scopes: ['mcp:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
      projectIds: [otherProject.id],
    });
    const unscoped = await createPersonalToken(pg.appPool, {
      orgId: org.id,
      userId: user.id,
      name: 'unscoped',
      scopes: ['mcp:read'],
      expiresAt: new Date(Date.now() + DAY_MS),
    });

    await revokeUserTokensForProject(pg.appPool, { orgId: org.id, userId: user.id, projectId: removedProject.id });

    const revoked = await findTokenById(pg.appPool, org.id, scopedToRemoved.record.id);
    const stillScopedElsewhere = await findTokenById(pg.appPool, org.id, scopedToOther.record.id);
    const stillUnscoped = await findTokenById(pg.appPool, org.id, unscoped.record.id);
    expect(revoked!.revokedAt).not.toBeNull();
    expect(stillScopedElsewhere!.revokedAt).toBeNull();
    expect(stillUnscoped!.revokedAt).toBeNull();
  });
});
