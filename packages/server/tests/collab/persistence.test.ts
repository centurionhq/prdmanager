/**
 * WO-145 — integration tests for `createCollabPersistenceExtension` (SDD-008 §"Servidor de tiempo
 * real"): a real Fastify + embedded Hocuspocus harness on an OS-assigned port (same shape as
 * `packages/server/tests/learning/hocuspocus-fastify.test.ts`), two real `HocuspocusProvider`s over
 * real `ws`, and a real Postgres test database. Every wait is on a real event (`synced`, a test-only
 * `afterStoreDocument` promise) — never a timer.
 */
import { randomUUID } from 'node:crypto';
import fastifyWebsocket from '@fastify/websocket';
import { Hocuspocus, type Extension } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { openTestPg, createOrganizationFixture, createProjectFixture, type PgTestDb } from '@prdm/testkit';
import Fastify, { type FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createCollabPersistenceExtension } from '../../src/collab/persistence.js';

interface DocumentFixture {
  id: string;
  orgId: string;
  projectId: string;
}

async function createCollabDocumentFixture(
  pg: PgTestDb,
  overrides: { orgId: string; projectId: string; pendingEditablePatch?: Record<string, unknown> },
): Promise<DocumentFixture> {
  const id = randomUUID();
  await pg.ownerPool.query(
    `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, pending_editable_patch)
     VALUES ($1, $2, $3, $4, 'PRD', 'Test doc', 'docs/prd/PRD-001-test.md', 'collab', 'draft', $5)`,
    [id, overrides.orgId, overrides.projectId, `PRD-${id.slice(0, 8)}`, overrides.pendingEditablePatch ? JSON.stringify(overrides.pendingEditablePatch) : null],
  );
  return { id, orgId: overrides.orgId, projectId: overrides.projectId };
}

/** WO-447: mirrors `createDraft`'s own version-1 insert (`documents-repository.ts`) — the only place a
 * freshly created document's real content lives before its first live collab session. */
async function insertDocumentVersion(pg: PgTestDb, orgId: string, documentId: string, versionNo: number, renderedMarkdown: string): Promise<void> {
  await pg.ownerPool.query(
    `INSERT INTO document_versions (org_id, document_id, version_no, reason, rendered_markdown, content_hash)
     VALUES ($1, $2, $3, 'manual', $4, 'test-hash')`,
    [orgId, documentId, versionNo, renderedMarkdown],
  );
}

interface Harness {
  app: FastifyInstance;
  hocuspocus: Hocuspocus;
  url: string;
}

function afterStoreDocumentOnce(extra: { onStored?: () => void } = {}): Extension {
  return {
    extensionName: 'test-store-signal',
    async afterStoreDocument() {
      extra.onStored?.();
    },
  };
}

async function startHarness(pool: PgTestDb['appPool'], onStored?: () => void): Promise<Harness> {
  const hocuspocus = new Hocuspocus({
    debounce: 0,
    maxDebounce: 0,
    yDocOptions: { gc: false, gcFilter: () => true },
    extensions: [createCollabPersistenceExtension({ pool }) as unknown as Extension, afterStoreDocumentOnce({ onStored })],
  });

  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });
  app.get('/collab', { websocket: true }, (socket, request) => {
    const connection = hocuspocus.handleConnection(socket, request.raw as unknown as Request);
    socket.on('message', (data: Uint8Array) => connection.handleMessage(data));
    socket.on('close', (event: unknown) => connection.handleClose(event as never));
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  return { app, hocuspocus, url: `ws://127.0.0.1:${address.port}/collab` };
}

function makeProvider(url: string, name: string): HocuspocusProvider {
  const config: object = { url, name, document: new Y.Doc({ gc: false }), WebSocketPolyfill: WebSocket };
  return new HocuspocusProvider(config as ConstructorParameters<typeof HocuspocusProvider>[0]);
}

function onceSynced(provider: HocuspocusProvider): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('synced', handler);
      resolve();
    };
    provider.on('synced', handler);
  });
}

describe('collab persistence (SDD-008, WO-145)', () => {
  let pg: PgTestDb;
  let org: { id: string };
  let project: { id: string };
  let harness: Harness | undefined;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    pg = await openTestPg();
    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });
  });

  afterAll(async () => {
    await pg.close();
  });

  afterEach(async () => {
    for (const provider of providers.splice(0)) provider.destroy();
    if (harness) {
      await harness.app.close();
      harness = undefined;
    }
  });

  test('onLoadDocument hydrates an empty document with no working_state (no-op)', async () => {
    const doc = await createCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    harness = await startHarness(pg.appPool);
    const provider = makeProvider(harness.url, `${project.id}:${doc.id}`);
    providers.push(provider);
    await onceSynced(provider);
    expect(provider.document.getText('body').toString()).toBe('');
  });

  test('onLoadDocument seeds fm/body from the latest document_versions row when working_state is null (WO-447)', async () => {
    const doc = await createCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const renderedMarkdown = '---\nid: "PRD-001"\ntype: "PRD"\ntitle: "Test doc"\nstatus: "draft"\ntags: ["from-template"]\n---\n\n## Resumen\n\nContenido de la plantilla.\n';
    await insertDocumentVersion(pg, org.id, doc.id, 1, renderedMarkdown);

    harness = await startHarness(pg.appPool);
    const provider = makeProvider(harness.url, `${project.id}:${doc.id}`);
    providers.push(provider);
    await onceSynced(provider);

    expect(provider.document.getText('body').toString()).toBe('## Resumen\n\nContenido de la plantilla.');
    expect(provider.document.getMap('fm').get('title')).toBe('Test doc');
    expect(provider.document.getMap('fm').get('tags')).toEqual(['from-template']);
  });

  test('onLoadDocument seeds from the highest version_no, not just version 1 (WO-447)', async () => {
    const doc = await createCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    await insertDocumentVersion(pg, org.id, doc.id, 1, '---\nid: "PRD-001"\ntype: "PRD"\ntitle: "Test doc"\nstatus: "draft"\n---\n\nv1 body\n');
    await insertDocumentVersion(pg, org.id, doc.id, 2, '---\nid: "PRD-001"\ntype: "PRD"\ntitle: "Test doc"\nstatus: "draft"\n---\n\nv2 body\n');

    harness = await startHarness(pg.appPool);
    const provider = makeProvider(harness.url, `${project.id}:${doc.id}`);
    providers.push(provider);
    await onceSynced(provider);

    expect(provider.document.getText('body').toString()).toBe('v2 body');
  });

  test('onLoadDocument applies WO-139 pending_editable_patch as a system:engine transaction and clears it', async () => {
    const doc = await createCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id, pendingEditablePatch: { tags: ['from-engine'] } });
    harness = await startHarness(pg.appPool);
    const provider = makeProvider(harness.url, `${project.id}:${doc.id}`);
    providers.push(provider);
    await onceSynced(provider);

    expect(provider.document.getMap('fm').get('tags')).toEqual(['from-engine']);

    const { rows } = await pg.ownerPool.query(`SELECT pending_editable_patch FROM documents WHERE id = $1`, [doc.id]);
    expect(rows[0].pending_editable_patch).toBeNull();
  });

  test('edits are persisted to working_state and survive a fresh Hocuspocus instance ("restart")', async () => {
    const doc = await createCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    let stored: () => void = () => {};
    const storedPromise = new Promise<void>((resolve) => {
      stored = resolve;
    });
    harness = await startHarness(pg.appPool, stored);
    const provider = makeProvider(harness.url, `${project.id}:${doc.id}`);
    providers.push(provider);
    await onceSynced(provider);

    provider.document.getText('body').insert(0, 'hello from before restart');
    await storedPromise;

    providers.splice(0).forEach((p) => p.destroy());
    await harness.app.close();
    harness = undefined;

    const { rows } = await pg.ownerPool.query(`SELECT working_state, snapshot_seq FROM documents WHERE id = $1`, [doc.id]);
    expect(rows[0].working_state).not.toBeNull();

    harness = await startHarness(pg.appPool);
    const reconnected = makeProvider(harness.url, `${project.id}:${doc.id}`);
    providers.push(reconnected);
    await onceSynced(reconnected);
    expect(reconnected.document.getText('body').toString()).toBe('hello from before restart');
  });

  test('onLoadDocument replays doc_updates rows written after the stored snapshot', async () => {
    const doc = await createCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    // Simulate a debounced-but-unflushed tail: a doc_updates row exists (seq=1) but documents.working_state/
    // snapshot_seq were never advanced past 0 — this is exactly the gap `onLoadDocument`'s replay closes.
    const scratch = new Y.Doc({ gc: false });
    scratch.getText('body').insert(0, 'replayed tail update');
    const update = Buffer.from(Y.encodeStateAsUpdate(scratch));
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, update) VALUES ($1, $2, 1, $3)`,
      [org.id, doc.id, update],
    );

    harness = await startHarness(pg.appPool);
    const provider = makeProvider(harness.url, `${project.id}:${doc.id}`);
    providers.push(provider);
    // `onLoadDocument` (which performs the replay) is fully awaited before the document accepts its
    // first connection, so the replayed content is already present by the time `synced` fires — no
    // polling needed, same reasoning as the pending-patch test above.
    await onceSynced(provider);
    expect(provider.document.getText('body').toString()).toBe('replayed tail update');
  });

  test('rejects a documentName that does not resolve to an existing document', async () => {
    harness = await startHarness(pg.appPool);
    const provider = makeProvider(harness.url, `${project.id}:${randomUUID()}`);
    providers.push(provider);
    // A thrown `onLoadDocument` surfaces on the wire exactly like a rejected `onAuthenticate` (both go
    // through Hocuspocus's own `writePermissionDenied` framing for that document, confirmed by reading
    // `ClientConnection`'s `setUpNewConnection` catch block) — the provider emits `authenticationFailed`,
    // never `close` (the underlying socket itself stays open, since it may multiplex other documents).
    const failure = await new Promise<{ reason: string }>((resolve) => {
      provider.on('authenticationFailed', (data: { reason: string }) => resolve(data));
    });
    expect(failure.reason).toBe('permission-denied');
  });
});
