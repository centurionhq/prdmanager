/**
 * WO-155 — live validation: after every collab store, `validateDocument` (core, `'edit'` mode) runs over
 * the just-stored projection, `documents.last_validation` is updated, and a `validation:updated`
 * stateless message reaches every connected client. Real Fastify + embedded Hocuspocus + a real
 * `HocuspocusProvider` + a real Postgres/Neo4j pair, same harness `authenticate.test.ts` established.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { seedUser } from '../helpers/seed-auth.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { makeCollabProvider, onceStateless, onceSynced, onceUnsyncedChangesSettled, startCollabApp } from './ws-test-helpers.js';

describe('live validation after collab store (SDD-008, WO-155)', () => {
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

  async function setupOrgProjectAndEditor() {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const editor = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    const built = await startCollabApp({ pool: pg.appPool, neo4j });
    const editorCookie = await signIn(built.app, editor.email);
    await built.app.close();
    return { org, project, editorCookie };
  }

  test('writing a forbidden static field is persisted to last_validation and broadcast', async () => {
    const { org, project, editorCookie } = await setupOrgProjectAndEditor();
    const documentId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const { app, url } = await startCollabApp({ pool: pg.appPool, neo4j });
    const headers = { cookie: editorCookie, origin: ISOLATION_ORIGIN };
    const provider = makeCollabProvider(url, `${project.id}:${documentId}`, headers);
    try {
      await onceSynced(provider);
      const statelessPromise = onceStateless(provider, (payload) => JSON.parse(payload).type === 'validation:updated');

      provider.document.getMap('fm').set('closed_at', '2026-01-01');
      provider.document.getText('body').insert(0, 'Some body content');
      await onceUnsyncedChangesSettled(provider);

      const stateless = await statelessPromise;
      const parsed = JSON.parse(stateless.payload) as { type: string; issues: { code: string; field?: string; severity: string }[] };
      expect(parsed.issues.some((i) => i.code === 'forbidden_field' && i.field === 'closed_at')).toBe(true);

      const { rows } = await pg.ownerPool.query('SELECT last_validation FROM documents WHERE id = $1', [documentId]);
      const persisted = rows[0].last_validation as { code: string; field?: string }[];
      expect(persisted.some((i) => i.code === 'forbidden_field' && i.field === 'closed_at')).toBe(true);
    } finally {
      provider.destroy();
      await app.close();
    }
  });

  test('editing frontmatter/body without touching any forbidden field never surfaces a forbidden_field issue', async () => {
    const { org, project, editorCookie } = await setupOrgProjectAndEditor();
    const documentId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const { app, url } = await startCollabApp({ pool: pg.appPool, neo4j });
    const headers = { cookie: editorCookie, origin: ISOLATION_ORIGIN };
    const provider = makeCollabProvider(url, `${project.id}:${documentId}`, headers);
    try {
      await onceSynced(provider);
      const statelessPromise = onceStateless(provider, (payload) => JSON.parse(payload).type === 'validation:updated');

      provider.document.getMap('fm').set('title', 'A perfectly ordinary title');
      provider.document.getText('body').insert(0, 'Some perfectly valid body content');
      await onceUnsyncedChangesSettled(provider);

      const stateless = await statelessPromise;
      const parsed = JSON.parse(stateless.payload) as { issues: { code: string }[] };
      // The fixture's synthetic doc_id doesn't match the real `KIND-NNN` id format, so a `schema` issue
      // about the id is expected here (unrelated to this WO) — what matters is that touching neither a
      // forbidden static field nor an unresolved link never produces those specific issue codes.
      expect(parsed.issues.some((i) => i.code === 'forbidden_field')).toBe(false);
      expect(parsed.issues.some((i) => i.code === 'broken_link')).toBe(false);
    } finally {
      provider.destroy();
      await app.close();
    }
  });

  test('a document created after the scan cache is warm validates its own existence cleanly on its first store (WO-396)', async () => {
    const { org, project, editorCookie } = await setupOrgProjectAndEditor();
    const warmId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id, docId: 'PRD-901' });
    const { app, url } = await startCollabApp({ pool: pg.appPool, neo4j });
    const headers = { cookie: editorCookie, origin: ISOLATION_ORIGIN };

    async function storeAndCollectIssues(documentId: string): Promise<{ code: string; message: string }[]> {
      const provider = makeCollabProvider(url, `${project.id}:${documentId}`, headers);
      try {
        await onceSynced(provider);
        const statelessPromise = onceStateless(provider, (payload) => JSON.parse(payload).type === 'validation:updated');
        provider.document.getMap('fm').set('title', 'A perfectly ordinary title');
        provider.document.getText('body').insert(0, 'Some body content');
        await onceUnsyncedChangesSettled(provider);
        const stateless = await statelessPromise;
        return (JSON.parse(stateless.payload) as { issues: { code: string; message: string }[] }).issues;
      } finally {
        provider.destroy();
      }
    }

    try {
      // Warms the per-project scan cache; graph_version never bumps below, so the cache is never invalidated.
      await storeAndCollectIssues(warmId);

      const freshId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id, docId: 'PRD-902' });
      const issues = await storeAndCollectIssues(freshId);

      // Guards against a false green: a schema issue returns before the existence check ever runs.
      expect(issues.filter((i) => i.code === 'schema')).toEqual([]);
      expect(issues.filter((i) => i.code === 'stale_base')).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
