/**
 * Runs the shared `ProjectEngine` contract suite (SDD-007 "Tests"; WO-135) against `PgProjectEngine` —
 * the counterpart to `packages/core/tests/integration/project-engine-contract.test.ts`, which runs the
 * exact same suite against the local, disk-backed `Engine`.
 */
import { randomBytes } from 'node:crypto';
import { Neo4jGraphDatabase, parseDocument } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, runProjectEngineContractTests, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll } from 'vitest';
import { createPgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';

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

afterAll(async () => {
  await neo4j.close();
  removeDir(tmpRoot);
  await pg.close();
});

runProjectEngineContractTests(async () => {
  const org = await createOrganizationFixture(pg);
  const fixture = await createProjectFixture(pg, { orgId: org.id });
  const project = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(fixture.id);
  if (!project) throw new Error('project fixture not found');
  const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
  await store.clear();
  const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), store });

  return {
    engine,
    seedDocument: async (relPath, content) => {
      const parsed = parseDocument(content, relPath);
      if (!parsed?.ok) throw new Error(`fixture content for ${relPath} does not parse: ${parsed ? parsed.error : 'no frontmatter'}`);
      const { id, kind, title } = parsed.doc.node;
      // `pg.ownerPool` (prdm_owner, bypasses RLS) rather than `pg.appPool`: seeding a fixture row
      // directly is not itself the thing under test, matching every other Postgres integration test in
      // this repo (see `packages/testkit/src/pg-factories.ts`'s own doc comment).
      await pg.ownerPool.query(
        `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
         VALUES ($1, $2, $3, $4, $5, $6, 'collab', 'published', $7)
         ON CONFLICT (project_id, doc_id) DO UPDATE SET title = EXCLUDED.title, published_raw = EXCLUDED.published_raw, updated_at = now()`,
        [org.id, project.id, id, kind, title, relPath, content],
      );
    },
    commitReferencing: async (id) => {
      const sha = randomBytes(20).toString('hex');
      await pg.ownerPool.query(
        `INSERT INTO "commits" (project_id, sha, org_id, trust, author, date, subject, refs) VALUES ($1, $2, $3, 'baseline', 'contract-test', now(), $4, $5)`,
        [project.id, sha, org.id, `chore: work on ${id}`, [id]],
      );
      return sha;
    },
    cleanup: async () => {
      await truncateAll(pg.ownerPool);
    },
  };
});
