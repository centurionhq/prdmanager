/**
 * `computeImpactsPathsDrift` (SDD-021 "Reconciliacion de impacts_paths desde CI", WO-427): the diff
 * between a blueprint's currently-declared `impacts_paths` and the files actually touched by commits
 * referencing its own Work Orders -- reproducing the exact SDD-016 incident shape (a missing `/**`
 * suffix silently never matching subdirectory files) as a concrete regression case.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { impactsPathsNarrowingSchema } from '@prdm/contracts';
import { createTenantDb, upsertReportedCommits, createCiToken, recordCodeReport, type ProjectRecord } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, createUserFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';
import { computeImpactsPathsDrift, computeImpactsPathsNarrowing } from '../../src/engine/impacts-paths-drift.js';
import { buildRemoteDocumentsPort } from '../../src/documents/remote-documents-port.js';

const BLUEPRINT_ID = 'SDD-001';
const WO_ID = 'WO-001';

const FEATURE_TEMPLATE = `---\nid: FR-001\ntype: FR\ntitle: "Example feature"\n---\n\n## Solicitud\n`;
const blueprintTemplate = (impactsPaths: string) => `---\nid: ${BLUEPRINT_ID}\ntype: SDD\ntitle: "Example blueprint"\narchitects: ["FR-001"]\nimpacts_paths: ["${impactsPaths}"]\n---\n\n## Contexto\n\n## Tareas\n\n- [ ] x\n`;
const WO_TEMPLATE = `---\nid: ${WO_ID}\ntype: WO\ntitle: "Do the thing"\nstatus: done\nimplements: ["${BLUEPRINT_ID}"]\n---\n\ntask\n`;

describe('computeImpactsPathsDrift (WO-427)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    const config = testConfig(tmpRoot);
    neo4j = Neo4jGraphDatabase.connect(config.neo4j);
    await neo4j.verify();
    await neo4j.migrate();
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await neo4j.close();
    removeDir(tmpRoot);
    await pg.close();
  });

  async function makeEngine(): Promise<{ engine: PgProjectEngine; orgId: string; projectId: string }> {
    const org = await createOrganizationFixture(pg);
    const fixture = await createProjectFixture(pg, { orgId: org.id });
    const project = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(fixture.id);
    if (!project) throw new Error('project fixture not found');
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
    await store.clear();
    const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), hashAlgoVersion: 1, store });
    return { engine, orgId: org.id, projectId: project.id };
  }

  async function seedDocs(orgId: string, projectId: string, impactsPaths: string): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001-example.md', 'collab', 'published', $3)`,
      [orgId, projectId, FEATURE_TEMPLATE],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'SDD', 'Example blueprint', 'docs/sdd/SDD-001-example.md', 'collab', 'published', $4)`,
      [orgId, projectId, BLUEPRINT_ID, blueprintTemplate(impactsPaths)],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'WO', 'Do the thing', 'docs/work-orders/WO-001-do-the-thing.md', 'generated', 'published', $4)`,
      [orgId, projectId, WO_ID, WO_TEMPLATE],
    );
  }

  async function reportCommit(orgId: string, projectId: string, sha: string, files: string[]): Promise<void> {
    const user = await createUserFixture(pg);
    const token = await createCiToken(pg.appPool, {
      orgId,
      projectIds: [projectId],
      name: 'ci',
      scopes: ['reports:baseline'],
      expiresAt: new Date(Date.now() + 86_400_000),
      createdBy: user.id,
    });
    await upsertReportedCommits(pg.appPool, {
      projectId,
      orgId,
      tokenId: token.record.id,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha, author: 'Alice', date: '2026-09-17T00:00:00.000Z', subject: `feat: x\n\nRefs: ${WO_ID}`, refs: [WO_ID], files }],
    });
  }

  test('reproduces the SDD-016 incident shape: a pattern missing /** never matches subdirectory files, surfaced as a suggestion', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    // The exact bug: "packages/core/tests" (no /**) never matches a file under that directory.
    await seedDocs(orgId, projectId, 'packages/core/tests');
    await reportCommit(orgId, projectId, 'a'.repeat(40), ['packages/core/tests/unit/foo.test.ts', 'packages/core/tests/integration/bar.test.ts']);

    const drift = await computeImpactsPathsDrift(pg.appPool, orgId, projectId, (await engine.scan()).docs, BLUEPRINT_ID);

    expect(drift).not.toBeNull();
    expect(drift!.currentPatterns).toEqual(['packages/core/tests']);
    expect(drift!.suggestedAdditions).toEqual(['packages/core/tests/integration/bar.test.ts', 'packages/core/tests/unit/foo.test.ts']);
    expect(drift!.basedOnCommits).toEqual(['a'.repeat(40)]);
  });

  test('a file already covered by the current pattern is not suggested again', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocs(orgId, projectId, 'packages/core/tests/**');
    await reportCommit(orgId, projectId, 'b'.repeat(40), ['packages/core/tests/unit/foo.test.ts']);

    const drift = await computeImpactsPathsDrift(pg.appPool, orgId, projectId, (await engine.scan()).docs, BLUEPRINT_ID);

    expect(drift!.suggestedAdditions).toEqual([]);
  });

  test('a commit referencing an unrelated WO never contributes to the suggestion', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocs(orgId, projectId, 'packages/core/tests');
    const user = await createUserFixture(pg);
    const token = await createCiToken(pg.appPool, {
      orgId,
      projectIds: [projectId],
      name: 'ci',
      scopes: ['reports:baseline'],
      expiresAt: new Date(Date.now() + 86_400_000),
      createdBy: user.id,
    });
    await upsertReportedCommits(pg.appPool, {
      projectId,
      orgId,
      tokenId: token.record.id,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha: 'c'.repeat(40), author: 'Alice', date: '2026-09-17T00:00:00.000Z', subject: 'unrelated\n\nRefs: WO-999', refs: ['WO-999'], files: ['unrelated/file.ts'] }],
    });

    const drift = await computeImpactsPathsDrift(pg.appPool, orgId, projectId, (await engine.scan()).docs, BLUEPRINT_ID);

    expect(drift!.suggestedAdditions).toEqual([]);
    expect(drift!.basedOnCommits).toEqual([]);
  });

  test('returns null for a nonexistent blueprint id', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocs(orgId, projectId, 'packages/core/tests/**');

    const drift = await computeImpactsPathsDrift(pg.appPool, orgId, projectId, (await engine.scan()).docs, 'SDD-999');

    expect(drift).toBeNull();
  });
});

/**
 * `computeImpactsPathsNarrowing` (SDD-072 D2, WO-642): the inverse mirror of the drift above -- patterns of
 * a blueprint's `impacts_paths` that its own Work Orders never touched yet are de-facto shared.
 */
describe('computeImpactsPathsNarrowing (WO-642)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    const config = testConfig(tmpRoot);
    neo4j = Neo4jGraphDatabase.connect(config.neo4j);
    await neo4j.verify();
    await neo4j.migrate();
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await neo4j.close();
    removeDir(tmpRoot);
    await pg.close();
  });

  const sha = (n: number): string => n.toString(16).padStart(40, '0');
  const SHARED = 'packages/shared/**';
  const OWN_TESTS = 'packages/core/tests/**';

  interface Ctx {
    engine: PgProjectEngine;
    orgId: string;
    projectId: string;
    tokenId: string;
    projectRow: ProjectRecord;
  }

  async function makeCtx(): Promise<Ctx> {
    const org = await createOrganizationFixture(pg);
    const fixture = await createProjectFixture(pg, { orgId: org.id });
    const project = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(fixture.id);
    if (!project) throw new Error('project fixture not found');
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
    await store.clear();
    const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), hashAlgoVersion: 1, store });
    const user = await createUserFixture(pg);
    const token = await createCiToken(pg.appPool, { orgId: org.id, projectIds: [project.id], name: 'ci', scopes: ['reports:baseline'], expiresAt: new Date(Date.now() + 86_400_000), createdBy: user.id });
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001-example.md', 'collab', 'published', $3)`,
      [org.id, project.id, FEATURE_TEMPLATE],
    );
    return { engine, orgId: org.id, projectId: project.id, tokenId: token.record.id, projectRow: project };
  }

  async function seedBlueprint(ctx: Ctx, id: string, patterns: readonly string[]): Promise<void> {
    const raw = `---\nid: ${id}\ntype: SDD\ntitle: "Blueprint ${id}"\narchitects: ["FR-001"]\nimpacts_paths: [${patterns.map((p) => `"${p}"`).join(', ')}]\n---\n\n## Contexto\n\n## Tareas\n\n- [ ] x\n`;
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'SDD', $4, $5, 'collab', 'published', $6)`,
      [ctx.orgId, ctx.projectId, id, `Blueprint ${id}`, `docs/sdd/${id}-example.md`, raw],
    );
  }

  async function seedWo(ctx: Ctx, id: string, blueprintId: string): Promise<void> {
    const raw = `---\nid: ${id}\ntype: WO\ntitle: "Do ${id}"\nstatus: done\nimplements: ["${blueprintId}"]\n---\n\ntask\n`;
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'WO', $4, $5, 'generated', 'published', $6)`,
      [ctx.orgId, ctx.projectId, id, `Do ${id}`, `docs/work-orders/${id}-do.md`, raw],
    );
  }

  async function reportCommitFor(ctx: Ctx, woId: string, commitSha: string, files: string[]): Promise<void> {
    await upsertReportedCommits(pg.appPool, {
      projectId: ctx.projectId,
      orgId: ctx.orgId,
      tokenId: ctx.tokenId,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha: commitSha, author: 'Alice', date: '2026-09-17T00:00:00.000Z', subject: `feat: x\n\nRefs: ${woId}`, refs: [woId], files }],
    });
  }

  /** SDD-001 (own WO-001) declares OWN_TESTS + SHARED; SDD-002 (WO-002) also declares SHARED. */
  async function seedSharedScenario(ctx: Ctx, foreignCount: number): Promise<void> {
    await seedBlueprint(ctx, 'SDD-001', [OWN_TESTS, SHARED]);
    await seedWo(ctx, 'WO-001', 'SDD-001');
    await seedBlueprint(ctx, 'SDD-002', [SHARED]);
    await seedWo(ctx, 'WO-002', 'SDD-002');
    await reportCommitFor(ctx, 'WO-001', sha(1), ['packages/core/tests/unit/a.test.ts']);
    for (let i = 0; i < foreignCount; i++) await reportCommitFor(ctx, 'WO-002', sha(10 + i), ['packages/shared/x.ts']);
  }

  const narrow = async (ctx: Ctx, id = 'SDD-001') => computeImpactsPathsNarrowing(pg.appPool, ctx.orgId, ctx.projectId, (await ctx.engine.scan()).docs, id);

  test('suggests removing a de-facto shared pattern its own Work Orders never touched', async () => {
    const ctx = await makeCtx();
    await seedSharedScenario(ctx, 3);

    const narrowing = await narrow(ctx);

    expect(narrowing!.suggestedRemovals).toEqual([
      { pattern: SHARED, matchedPaths: ['packages/shared/x.ts'], foreignCommits: [sha(10), sha(11), sha(12)], alsoDeclaredBy: ['SDD-002'], driftIssueCount: 0 },
    ]);
    expect(narrowing!.currentPatterns).toEqual([OWN_TESTS, SHARED]);
    expect(narrowing!.basedOnCommits).toEqual([sha(1), sha(10), sha(11), sha(12)]);
  });

  test('does not suggest a pattern its own Work Orders did touch', async () => {
    const ctx = await makeCtx();
    await seedSharedScenario(ctx, 3);
    await reportCommitFor(ctx, 'WO-001', sha(2), ['packages/shared/y.ts']);

    expect((await narrow(ctx))!.suggestedRemovals).toEqual([]);
  });

  test('does not suggest a pattern that is not shared', async () => {
    const ctx = await makeCtx();
    await seedSharedScenario(ctx, 1);

    expect((await narrow(ctx))!.suggestedRemovals).toEqual([]);
  });

  test('declared-by threshold: this + 5 others suggests, this + 4 others does not', async () => {
    const ctx = await makeCtx();
    await seedBlueprint(ctx, 'SDD-001', [OWN_TESTS, SHARED]);
    await seedWo(ctx, 'WO-001', 'SDD-001');
    await reportCommitFor(ctx, 'WO-001', sha(1), ['packages/core/tests/unit/a.test.ts']);
    for (const n of [2, 3, 4, 5]) await seedBlueprint(ctx, `SDD-00${n}`, [SHARED]);

    expect((await narrow(ctx))!.suggestedRemovals).toEqual([]);

    await seedBlueprint(ctx, 'SDD-006', [SHARED]);

    const suggested = (await narrow(ctx))!.suggestedRemovals;
    expect(suggested.map((r) => r.pattern)).toEqual([SHARED]);
    expect(suggested[0]!.alsoDeclaredBy).toEqual(['SDD-002', 'SDD-003', 'SDD-004', 'SDD-005', 'SDD-006']);
    expect(suggested[0]!.foreignCommits).toEqual([]);
  });

  test('a blueprint without Work Orders gets no suggestions', async () => {
    const ctx = await makeCtx();
    await seedSharedScenario(ctx, 3);
    await seedBlueprint(ctx, 'SDD-003', [SHARED]);

    const narrowing = await narrow(ctx, 'SDD-003');

    expect(narrowing!.suggestedRemovals).toEqual([]);
    expect(narrowing!.basedOnCommits).toEqual([]);
  });

  test('counts only code_out_of_sync issues of this blueprint whose target matches the pattern', async () => {
    const ctx = await makeCtx();
    await seedSharedScenario(ctx, 3);
    const issue = (nodeId: string, target: string, kind = 'code_out_of_sync') => ({ kind, severity: 'warning' as const, nodeId, target, message: 'm' });
    await recordCodeReport(pg.appPool, {
      projectId: ctx.projectId,
      orgId: ctx.orgId,
      tokenId: ctx.tokenId,
      idempotencyKey: 'k1',
      bodySha256: 'b1',
      mode: 'baseline',
      headSha: sha(99),
      branch: 'main',
      result: {
        mode: 'baseline',
        reportId: 'r1',
        headSha: sha(99),
        issues: [issue('SDD-001', 'packages/shared/x.ts'), issue('SDD-001', 'packages/core/tests/unit/a.test.ts'), issue('SDD-002', 'packages/shared/x.ts'), issue('SDD-001', 'packages/shared/z.ts', 'other_kind')],
        hasBlockingIssues: false,
      },
    });

    const narrowing = await narrow(ctx);

    expect(narrowing!.suggestedRemovals.map((r) => [r.pattern, r.driftIssueCount])).toEqual([[SHARED, 1]]);
    expect(narrowing!.basedOnCommits).toEqual([...narrowing!.basedOnCommits].sort());
  });

  test('returns null for a nonexistent or non-Blueprint id', async () => {
    const ctx = await makeCtx();
    await seedSharedScenario(ctx, 3);

    expect(await narrow(ctx, 'SDD-999')).toBeNull();
    expect(await narrow(ctx, 'WO-001')).toBeNull();
  });

  test('result parses against the hand-synced contract schema', async () => {
    const ctx = await makeCtx();
    await seedSharedScenario(ctx, 3);

    const narrowing = await narrow(ctx);

    expect(() => impactsPathsNarrowingSchema.parse(narrowing)).not.toThrow();
  });

  test('the remote documents port exposes the same suggestedRemovals', async () => {
    const ctx = await makeCtx();
    await seedSharedScenario(ctx, 3);

    const drift = await buildRemoteDocumentsPort(pg.appPool, ctx.orgId, ctx.projectRow, ctx.engine).getImpactsPathsDrift('SDD-001');

    expect(drift!.suggestedRemovals).toEqual((await narrow(ctx))!.suggestedRemovals);
    expect(drift!.suggestedRemovals).toHaveLength(1);
  });
});
