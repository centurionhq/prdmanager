/**
 * `upsertReportedCommits` (SDD-010 "Commits reportados con nivel de confianza", WO-182): baseline
 * always wins, a preview report can never downgrade or overwrite an already-baseline row.
 */
import { createCiToken, findCommitsReferencingAny, listCommits, upsertReportedCommits } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, createUserFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

let pg: PgTestDb;
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  pg = await openTestPg();
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

async function setup() {
  const org = await createOrganizationFixture(pg);
  const user = await createUserFixture(pg);
  const project = await createProjectFixture(pg, { orgId: org.id });
  const token = await createCiToken(pg.appPool, {
    orgId: org.id,
    projectIds: [project.id],
    name: 'ci',
    scopes: ['reports:baseline'],
    expiresAt: new Date(Date.now() + DAY_MS),
    createdBy: user.id,
  });
  return { org, project, tokenId: token.record.id };
}

describe('upsertReportedCommits (WO-182)', () => {
  test('a baseline report replaces a previously-preview commit\'s message/refs and trust', async () => {
    const { org, project, tokenId } = await setup();
    const sha = 'a'.repeat(40);

    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'preview',
      branch: 'feature-x',
      commits: [{ sha, author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'wip', refs: [], files: ['a.ts'] }],
    });

    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha, author: 'Alice', date: '2026-09-14T01:00:00.000Z', subject: 'feat: x\n\nRefs: WO-182', refs: ['WO-182'], files: ['a.ts', 'b.ts'] }],
    });

    const { rows } = await pg.ownerPool.query(`SELECT trust, subject, refs, branches FROM "commits" WHERE project_id = $1 AND sha = $2`, [project.id, sha]);
    expect(rows[0].trust).toBe('baseline');
    expect(rows[0].subject).toBe('feat: x\n\nRefs: WO-182');
    expect(rows[0].refs).toEqual(['WO-182']);
    expect(rows[0].branches.sort()).toEqual(['feature-x', 'main']);
  });

  test('a preview report can never downgrade or overwrite an already-baseline commit (the developer-spoofing case)', async () => {
    const { org, project, tokenId } = await setup();
    const sha = 'b'.repeat(40);

    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha, author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'feat: real\n\nRefs: WO-182', refs: ['WO-182'], files: ['a.ts'] }],
    });

    // A developer's own (non-CI) report claims a completely different message/refs for the exact same
    // sha — this repository has no field a caller could set to "trust me, apply this as baseline"; the
    // route layer is what decides `trust` from the token's own verified scope+OIDC state, never from
    // request data, but this proves the repository itself refuses the downgrade even if it were called
    // with attacker-controlled fields.
    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'preview',
      branch: 'main',
      commits: [{ sha, author: 'Mallory', date: '2026-09-14T02:00:00.000Z', subject: 'totally not what happened', refs: ['WO-999'], files: ['evil.ts'] }],
    });

    const { rows } = await pg.ownerPool.query(`SELECT trust, subject, refs, author FROM "commits" WHERE project_id = $1 AND sha = $2`, [project.id, sha]);
    expect(rows[0].trust).toBe('baseline');
    expect(rows[0].subject).toBe('feat: real\n\nRefs: WO-182');
    expect(rows[0].refs).toEqual(['WO-182']);
    expect(rows[0].author).toBe('Alice');
  });

  test('first_seen_at is set once and never advanced by a later report of the same sha', async () => {
    const { org, project, tokenId } = await setup();
    const sha = 'c'.repeat(40);

    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'preview',
      branch: 'main',
      commits: [{ sha, author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'wip', refs: [], files: [] }],
    });
    const { rows: firstRows } = await pg.ownerPool.query(`SELECT first_seen_at FROM "commits" WHERE project_id = $1 AND sha = $2`, [project.id, sha]);
    const firstSeenAt = firstRows[0].first_seen_at;

    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha, author: 'Alice', date: '2026-09-14T01:00:00.000Z', subject: 'feat: x', refs: [], files: [] }],
    });
    const { rows: secondRows } = await pg.ownerPool.query(`SELECT first_seen_at FROM "commits" WHERE project_id = $1 AND sha = $2`, [project.id, sha]);
    expect(secondRows[0].first_seen_at).toEqual(firstSeenAt);
  });
});

describe('listCommits (WO-332)', () => {
  test('paginates newest-first with a cursor, no gaps or duplicates', async () => {
    const { org, project, tokenId } = await setup();
    for (let i = 0; i < 5; i += 1) {
      await upsertReportedCommits(pg.appPool, {
        projectId: project.id,
        orgId: org.id,
        tokenId,
        trust: 'baseline',
        branch: 'main',
        commits: [{ sha: `${i}`.repeat(40), author: 'Alice', date: new Date(Date.now() + i * DAY_MS).toISOString(), subject: `commit ${i}`, refs: [], files: [] }],
      });
    }

    const firstPage = await listCommits(pg.appPool, { orgId: org.id, projectId: project.id, limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items[0]?.subject).toBe('commit 4');
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listCommits(pg.appPool, { orgId: org.id, projectId: project.id, limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.items).toHaveLength(2);

    const thirdPage = await listCommits(pg.appPool, { orgId: org.id, projectId: project.id, limit: 2, cursor: secondPage.nextCursor });
    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.nextCursor).toBeNull();

    const allShas = [...firstPage.items, ...secondPage.items, ...thirdPage.items].map((r) => r.sha);
    expect(new Set(allShas).size).toBe(5);
  });

  test('only returns commits for the given project', async () => {
    const { org, project, tokenId } = await setup();
    const otherProject = await createProjectFixture(pg, { orgId: org.id });
    const otherToken = await createCiToken(pg.appPool, {
      orgId: org.id,
      projectIds: [otherProject.id],
      name: 'ci-2',
      scopes: ['reports:baseline'],
      expiresAt: new Date(Date.now() + DAY_MS),
      createdBy: (await createUserFixture(pg)).id,
    });

    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha: 'a'.repeat(40), author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'in project', refs: [], files: [] }],
    });
    await upsertReportedCommits(pg.appPool, {
      projectId: otherProject.id,
      orgId: org.id,
      tokenId: otherToken.record.id,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha: 'b'.repeat(40), author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'other project', refs: [], files: [] }],
    });

    const page = await listCommits(pg.appPool, { orgId: org.id, projectId: project.id, limit: 10 });
    expect(page.items.map((r) => r.subject)).toEqual(['in project']);
  });
});

describe('findCommitsReferencingAny (SDD-021, WO-427)', () => {
  test('returns only commits whose refs overlap the given WO ids, any trust level, unioning files', async () => {
    const { org, project, tokenId } = await setup();
    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'baseline',
      branch: 'main',
      commits: [
        { sha: 'a'.repeat(40), author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'feat: x\n\nRefs: WO-427', refs: ['WO-427'], files: ['src/a.ts', 'src/b.ts'] },
        { sha: 'b'.repeat(40), author: 'Alice', date: '2026-09-14T01:00:00.000Z', subject: 'unrelated', refs: ['WO-999'], files: ['src/other.ts'] },
      ],
    });
    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'preview',
      branch: 'feature-x',
      commits: [{ sha: 'c'.repeat(40), author: 'Bob', date: '2026-09-14T02:00:00.000Z', subject: 'wip\n\nRefs: WO-428', refs: ['WO-428'], files: ['src/c.ts'] }],
    });

    const rows = await findCommitsReferencingAny(pg.appPool, org.id, project.id, ['WO-427', 'WO-428']);

    expect(rows.map((r) => r.sha).sort()).toEqual(['a'.repeat(40), 'c'.repeat(40)].sort());
    const allFiles = new Set(rows.flatMap((r) => r.files));
    expect(allFiles).toEqual(new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']));
  });

  test('returns an empty array for an empty woIds list, without querying', async () => {
    const { org, project } = await setup();
    const rows = await findCommitsReferencingAny(pg.appPool, org.id, project.id, []);
    expect(rows).toEqual([]);
  });

  test('never returns a commit from another project', async () => {
    const { org, project, tokenId } = await setup();
    const otherProject = await createProjectFixture(pg, { orgId: org.id });
    const otherToken = await createCiToken(pg.appPool, {
      orgId: org.id,
      projectIds: [otherProject.id],
      name: 'ci-2',
      scopes: ['reports:baseline'],
      expiresAt: new Date(Date.now() + DAY_MS),
      createdBy: (await createUserFixture(pg)).id,
    });
    await upsertReportedCommits(pg.appPool, {
      projectId: otherProject.id,
      orgId: org.id,
      tokenId: otherToken.record.id,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha: 'd'.repeat(40), author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'x\n\nRefs: WO-427', refs: ['WO-427'], files: ['leaked.ts'] }],
    });
    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha: 'e'.repeat(40), author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'x\n\nRefs: WO-427', refs: ['WO-427'], files: ['own.ts'] }],
    });

    const rows = await findCommitsReferencingAny(pg.appPool, org.id, project.id, ['WO-427']);

    expect(rows.map((r) => r.sha)).toEqual(['e'.repeat(40)]);
  });
});
