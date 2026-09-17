/**
 * `computeImpactsPathsDrift` (SDD-021 "Reconciliacion de impacts_paths desde CI", WO-427): the diff
 * between a blueprint's currently-declared `impacts_paths` and the files actually touched by commits
 * referencing its own Work Orders -- reproducing the exact SDD-016 incident shape (a missing `/**`
 * suffix silently never matching subdirectory files) as a concrete regression case.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createTenantDb, upsertReportedCommits, createCiToken } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, createUserFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';
import { computeImpactsPathsDrift } from '../../src/engine/impacts-paths-drift.js';

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

    const drift = await computeImpactsPathsDrift(pg.appPool, orgId, projectId, engine, BLUEPRINT_ID);

    expect(drift).not.toBeNull();
    expect(drift!.currentPatterns).toEqual(['packages/core/tests']);
    expect(drift!.suggestedAdditions).toEqual(['packages/core/tests/integration/bar.test.ts', 'packages/core/tests/unit/foo.test.ts']);
    expect(drift!.basedOnCommits).toEqual(['a'.repeat(40)]);
  });

  test('a file already covered by the current pattern is not suggested again', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocs(orgId, projectId, 'packages/core/tests/**');
    await reportCommit(orgId, projectId, 'b'.repeat(40), ['packages/core/tests/unit/foo.test.ts']);

    const drift = await computeImpactsPathsDrift(pg.appPool, orgId, projectId, engine, BLUEPRINT_ID);

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

    const drift = await computeImpactsPathsDrift(pg.appPool, orgId, projectId, engine, BLUEPRINT_ID);

    expect(drift!.suggestedAdditions).toEqual([]);
    expect(drift!.basedOnCommits).toEqual([]);
  });

  test('returns null for a nonexistent blueprint id', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocs(orgId, projectId, 'packages/core/tests/**');

    const drift = await computeImpactsPathsDrift(pg.appPool, orgId, projectId, engine, 'SDD-999');

    expect(drift).toBeNull();
  });
});
