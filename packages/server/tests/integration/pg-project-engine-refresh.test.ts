/**
 * `PgProjectEngine.refresh()`'s reconciliation-by-hash (SDD-007 "PgProjectEngine"; WO-134):
 * `project_code_state.impacts_hashes` records, per blueprint, the hash of its `impacts_paths` as of the
 * last CI-verified report that covered it. A blueprint whose current `impacts_paths` still hashes to
 * that value is reconciled normally; one that doesn't (including "never reported") gets a non-blocking
 * `awaiting_ci_report` issue and keeps its previously recorded `baseline.governs` entry untouched.
 */
import { Neo4jGraphDatabase, sha256, type GraphStore } from '@prdm/core';
import { createCiToken, createTenantDb, upsertReportedCommits } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, createUserFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';

const BLUEPRINT_ID = 'SDD-001';

const BLUEPRINT_TEMPLATE = (impactsPaths: string[]): string => `---
id: ${BLUEPRINT_ID}
type: SDD
title: "Example blueprint"
architects: ["FR-001"]
impacts_paths: ${JSON.stringify(impactsPaths)}
---

## Contexto

Example.
`;

/** Mirrors `PgProjectEngine`'s own private `impactsPathsHash` exactly (order-independent hash of the
 * `impacts_paths` array itself, never of code content) — there is no public export for it since it's
 * purely an internal reconciliation detail, not part of the `ProjectEngine` contract. */
function impactsPathsHash(paths: readonly string[]): string {
  return sha256(JSON.stringify([...paths].sort()));
}

describe('PgProjectEngine.refresh() reconciliation-by-hash (WO-134)', () => {
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

  async function makeEngine(): Promise<{ engine: PgProjectEngine; orgId: string; projectId: string; store: GraphStore }> {
    const org = await createOrganizationFixture(pg);
    const fixture = await createProjectFixture(pg, { orgId: org.id });
    const project = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(fixture.id);
    if (!project) throw new Error('project fixture not found');
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
    await store.clear();
    const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), store });
    return { engine, orgId: org.id, projectId: project.id, store };
  }

  const FEATURE_TEMPLATE = `---
id: FR-001
type: FR
title: "Example feature"
---

## Solicitud
`;

  async function seedPublishedBlueprint(orgId: string, projectId: string, impactsPaths: string[]): Promise<void> {
    // The blueprint's `architects: ["FR-001"]` edge needs a real target, or `detectDrift`'s own
    // link-checking (unrelated to WO-134) would flag it as a blocking `broken_link` on its own.
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001-example.md', 'collab', 'published', $3)`,
      [orgId, projectId, FEATURE_TEMPLATE],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'SDD', 'Example blueprint', 'docs/sdd/SDD-001-example.md', 'collab', 'published', $4)`,
      [orgId, projectId, BLUEPRINT_ID, BLUEPRINT_TEMPLATE(impactsPaths)],
    );
  }

  async function seedImpactsHash(orgId: string, projectId: string, hash: string): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "project_code_state" (project_id, org_id, impacts_hashes) VALUES ($1, $2, $3::jsonb)`,
      [projectId, orgId, JSON.stringify({ [BLUEPRINT_ID]: hash })],
    );
  }

  async function seedBaselineGoverns(orgId: string, projectId: string, governs: Record<string, Record<string, string>>): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "project_baselines" (project_id, org_id, baseline) VALUES ($1, $2, $3::jsonb)`,
      [projectId, orgId, JSON.stringify({ version: 1, docs: {}, governs })],
    );
  }

  async function readBaseline(projectId: string): Promise<{ version: number; docs: Record<string, string>; governs: Record<string, Record<string, string>> }> {
    const [row] = await pg.ownerPool.query(`SELECT baseline FROM "project_baselines" WHERE project_id = $1`, [projectId]).then((r) => r.rows);
    return row.baseline;
  }

  test('a blueprint never reported gets a non-blocking awaiting_ci_report warning', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedPublishedBlueprint(orgId, projectId, ['src/a.ts']);

    const report = await engine.refresh();

    // Unrelated lifecycle rules (SDD-002 §3, PRD-002) also flag this deliberately minimal fixture as
    // blocking; only `awaiting_ci_report` itself — its severity and that it is never blocking on its
    // own — is this WO's concern.
    const warning = report.issues.find((i) => i.kind === 'awaiting_ci_report');
    expect(warning?.nodeId).toBe(BLUEPRINT_ID);
    expect(warning?.severity).toBe('warning');
  });

  test('SDD-021/WO-428: the awaiting_ci_report warning carries a suggested impacts_paths addition when CI-reported commits under the blueprint\'s own WOs touched an uncovered file', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedPublishedBlueprint(orgId, projectId, ['src/a.ts']);
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'WO-001', 'WO', 'Do the thing', 'docs/work-orders/WO-001.md', 'generated', 'published', $3)`,
      [orgId, projectId, '---\nid: WO-001\ntype: WO\ntitle: "Do the thing"\nstatus: done\nimplements: ["SDD-001"]\n---\n\ntask\n'],
    );
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
      commits: [{ sha: 'a'.repeat(40), author: 'Alice', date: '2026-09-17T00:00:00.000Z', subject: 'feat: x\n\nRefs: WO-001', refs: ['WO-001'], files: ['src/uncovered.ts'] }],
    });

    const report = await engine.refresh();

    const warning = report.issues.find((i) => i.kind === 'awaiting_ci_report');
    expect(warning?.suggestedImpactsPathsAdditions).toEqual(['src/uncovered.ts']);
  });

  test('a blueprint whose impacts_paths hash still matches the last report gets no warning', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedPublishedBlueprint(orgId, projectId, ['src/a.ts']);
    await seedImpactsHash(orgId, projectId, impactsPathsHash(['src/a.ts']));

    const report = await engine.refresh();

    expect(report.issues.find((i) => i.kind === 'awaiting_ci_report')).toBeUndefined();
  });

  test('a stale blueprint (hash mismatch) keeps its previously recorded baseline.governs entry untouched', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedPublishedBlueprint(orgId, projectId, ['src/a.ts', 'src/b.ts']);
    // Reported hash is for the OLD impacts_paths (before src/b.ts was added) -> stale now.
    await seedImpactsHash(orgId, projectId, impactsPathsHash(['src/a.ts']));
    await seedBaselineGoverns(orgId, projectId, { [BLUEPRINT_ID]: { 'src/a.ts#foo': 'deadbeef' } });

    const report = await engine.refresh();

    expect(report.issues.some((i) => i.kind === 'awaiting_ci_report' && i.nodeId === BLUEPRINT_ID)).toBe(true);
    const baseline = await readBaseline(projectId);
    expect(baseline.governs[BLUEPRINT_ID]).toEqual({ 'src/a.ts#foo': 'deadbeef' });
  });

  test('a reconciled blueprint (hash matches) is not defensively preserved from its old baseline', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedPublishedBlueprint(orgId, projectId, ['src/a.ts']);
    await seedImpactsHash(orgId, projectId, impactsPathsHash(['src/a.ts']));
    await seedBaselineGoverns(orgId, projectId, { [BLUEPRINT_ID]: { 'src/a.ts#foo': 'deadbeef' } });

    await engine.refresh();

    const baseline = await readBaseline(projectId);
    // No live per-ref code state exists yet (SDD-010 owns providing it) so a *reconciled* blueprint
    // correctly ends up with no governed entries, unlike a stale one which keeps its old value as-is.
    expect(baseline.governs[BLUEPRINT_ID]).toBeUndefined();
  });

  test('inspect() reports the same awaiting_ci_report warning without writing a baseline', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedPublishedBlueprint(orgId, projectId, ['src/a.ts']);

    const report = await engine.inspect();

    expect(report.issues.some((i) => i.kind === 'awaiting_ci_report' && i.nodeId === BLUEPRINT_ID)).toBe(true);
    expect(report.baselineWritten).toBe(false);
    const [row] = await pg.ownerPool.query(`SELECT count(*)::int AS count FROM "project_baselines" WHERE project_id = $1`, [projectId]).then((r) => r.rows);
    expect(row.count).toBe(0);
  });
});
