/**
 * `project_code_refs` repository (SDD-012, WO-332): the transactional replace WO-333 calls after a
 * baseline code report, and the per-project listing WO-334 reads from in `buildDriftInput`.
 */
import { randomUUID } from 'node:crypto';
import { listProjectCodeRefs, replaceProjectCodeRefs } from '@prdm/db';
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

describe('replaceProjectCodeRefs / listProjectCodeRefs (WO-332)', () => {
  test('inserts a fresh set of refs for a blueprint', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    await replaceProjectCodeRefs(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      blueprintId: 'SDD-001',
      reportId: randomUUID(),
      headSha: 'a'.repeat(40),
      refs: [
        { refKey: 'src/foo.ts', path: 'src/foo.ts', symbol: null, hash: 'b'.repeat(64), hashAlgoVersion: 1 },
        { refKey: 'src/bar.ts#run', path: 'src/bar.ts', symbol: 'run', hash: 'c'.repeat(64), hashAlgoVersion: 1 },
      ],
    });

    const refs = await listProjectCodeRefs(pg.appPool, { orgId: org.id, projectId: project.id });
    expect(refs.map((r) => r.refKey).sort()).toEqual(['src/bar.ts#run', 'src/foo.ts']);
  });

  test('replacing a blueprint deletes its previous refs entirely (not a merge)', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const reportId = randomUUID();

    await replaceProjectCodeRefs(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      blueprintId: 'SDD-001',
      reportId,
      headSha: 'a'.repeat(40),
      refs: [{ refKey: 'src/old.ts', path: 'src/old.ts', symbol: null, hash: 'b'.repeat(64), hashAlgoVersion: 1 }],
    });
    await replaceProjectCodeRefs(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      blueprintId: 'SDD-001',
      reportId,
      headSha: 'b'.repeat(40),
      refs: [{ refKey: 'src/new.ts', path: 'src/new.ts', symbol: null, hash: 'c'.repeat(64), hashAlgoVersion: 1 }],
    });

    const refs = await listProjectCodeRefs(pg.appPool, { orgId: org.id, projectId: project.id });
    expect(refs.map((r) => r.refKey)).toEqual(['src/new.ts']);
  });

  test('replacing one blueprint never touches another blueprint\'s refs', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    await replaceProjectCodeRefs(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      blueprintId: 'SDD-001',
      reportId: randomUUID(),
      headSha: 'a'.repeat(40),
      refs: [{ refKey: 'src/a.ts', path: 'src/a.ts', symbol: null, hash: 'b'.repeat(64), hashAlgoVersion: 1 }],
    });
    await replaceProjectCodeRefs(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      blueprintId: 'SDD-002',
      reportId: randomUUID(),
      headSha: 'a'.repeat(40),
      refs: [{ refKey: 'src/b.ts', path: 'src/b.ts', symbol: null, hash: 'c'.repeat(64), hashAlgoVersion: 1 }],
    });

    const refs = await listProjectCodeRefs(pg.appPool, { orgId: org.id, projectId: project.id });
    expect(refs.map((r) => `${r.blueprintId}:${r.refKey}`).sort()).toEqual(['SDD-001:src/a.ts', 'SDD-002:src/b.ts']);
  });

  test('replacing with an empty ref list clears the blueprint entirely', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    await replaceProjectCodeRefs(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      blueprintId: 'SDD-001',
      reportId: randomUUID(),
      headSha: 'a'.repeat(40),
      refs: [{ refKey: 'src/a.ts', path: 'src/a.ts', symbol: null, hash: 'b'.repeat(64), hashAlgoVersion: 1 }],
    });
    await replaceProjectCodeRefs(pg.appPool, { projectId: project.id, orgId: org.id, blueprintId: 'SDD-001', reportId: randomUUID(), headSha: 'a'.repeat(40), refs: [] });

    expect(await listProjectCodeRefs(pg.appPool, { orgId: org.id, projectId: project.id })).toEqual([]);
  });

  test("another org's refs are invisible", async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: orgA.id });

    await replaceProjectCodeRefs(pg.appPool, {
      projectId: projectA.id,
      orgId: orgA.id,
      blueprintId: 'SDD-001',
      reportId: randomUUID(),
      headSha: 'a'.repeat(40),
      refs: [{ refKey: 'src/a.ts', path: 'src/a.ts', symbol: null, hash: 'b'.repeat(64), hashAlgoVersion: 1 }],
    });

    expect(await listProjectCodeRefs(pg.appPool, { orgId: orgB.id, projectId: projectA.id })).toEqual([]);
  });
});
