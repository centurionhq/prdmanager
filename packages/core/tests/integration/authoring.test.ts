import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { PrdmConfig } from '../../src/config.js';
import { AuthoringService } from '../../src/authoring/service.js';
import { DraftStore } from '../../src/authoring/draft-store.js';
import { DraftValidationError } from '../../src/authoring/types.js';
import { Engine } from '../../src/engine.js';
import { graphStaleMarkerExists } from '../../src/util/journal.js';
import type { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphSnapshot, GraphStore, MetricsRaw, NodeDetail, SearchHit, Subgraph, WorkOrderContextRaw, WorkOrderSummary } from '../../src/graph/types.js';
import type { NodeLabel } from '../../src/domain/schema.js';
import { createFixtureRepo, openTestDb, removeDir, testConfig } from '@prdm/testkit';

let root: string;
let config: PrdmConfig;
let db: Neo4jGraphDatabase;
let store: GraphStore;
let engine: Engine;
let authoring: AuthoringService;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
  await engine.refresh();
  authoring = new AuthoringService({ engine, drafts: new DraftStore(config.authoring) });
});

afterAll(async () => {
  await db?.close();
  if (root) removeDir(root);
});

describe('AuthoringService: create -> commit', () => {
  test('drafting a feedback item, validating and committing writes the file and indexes the graph node', async () => {
    const view = await authoring.draft({ kind: 'FB', title: 'Customers want alerts', body: 'They asked for drift alerts in Slack.', fields: { source: 'call' } });
    expect(view.mode).toBe('create');
    expect(view.targetId).toBe('FB-?');
    expect(view.revision).toBe(0);
    expect(view.validation.ok).toBe(true);
    expect(view.rendered).toContain('"FB-?"');

    const revalidated = await authoring.validate(view.draftId);
    expect(revalidated.validation.ok).toBe(true);

    const result = await authoring.commit(view.draftId, 0);
    expect(result.id).toMatch(/^FB-\d+$/);
    expect(result.hasBlockingIssues).toBe(false);

    const written = readFileSync(join(root, result.path), 'utf8');
    expect(written).toContain(`id: "${result.id}"`);
    expect(written).toContain('drift alerts in Slack');

    const node = await store.getNode(result.id);
    expect(node?.node).toMatchObject({ id: result.id, label: 'Feedback' });

    // The draft is gone, but a retried commit with the same draftId+revision replays the tombstoned result instead of erroring.
    expect(authoring.list().some((d) => d.draftId === view.draftId)).toBe(false);
    const retried = await authoring.commit(view.draftId, 0);
    expect(retried).toEqual(result);
  });

  test('committing a draft with a blocking validation issue throws and writes nothing', async () => {
    const view = await authoring.draft({ kind: 'FR', title: 'Broken', body: 'body', fields: { evolves_from: ['PRD-404'] } });
    expect(view.validation.ok).toBe(false);
    await expect(authoring.commit(view.draftId, 0)).rejects.toThrow(DraftValidationError);
    // the draft survives a failed (validation-only) commit attempt
    expect(authoring.list().some((d) => d.draftId === view.draftId)).toBe(true);
    authoring.discard(view.draftId);
  });

  test('WO cannot be drafted', async () => {
    await expect(authoring.draft({ kind: 'WO' as never, title: 'x', body: 'y' })).rejects.toThrow(/work orders cannot be drafted/);
  });

  test('two concurrent create-drafts of the same kind commit to distinct ids', async () => {
    const a = await authoring.draft({ kind: 'PRD', title: 'Concurrent Feature A', body: 'body a' });
    const b = await authoring.draft({ kind: 'PRD', title: 'Concurrent Feature B', body: 'body b' });

    const [resultA, resultB] = await Promise.all([authoring.commit(a.draftId, 0), authoring.commit(b.draftId, 0)]);
    expect(resultA.id).not.toBe(resultB.id);
    expect(existsSync(join(root, resultA.path))).toBe(true);
    expect(existsSync(join(root, resultB.path))).toBe(true);
  });
});

describe('AuthoringService: update drafts', () => {
  test('opening an update draft records the base hash, and committing replaces body and title while keeping other frontmatter', async () => {
    const view = await authoring.draft({ kind: 'MRD', title: 'Mercado de asistentes de código (revisado)', body: 'Nuevo contenido del mercado.', updateId: 'MRD-001' });
    expect(view.mode).toBe('update');
    expect(view.targetId).toBe('MRD-001');
    expect(view.targetPath).toBe('docs/mrd/MRD-001.md');
    expect(view.validation.ok).toBe(true);

    const result = await authoring.commit(view.draftId, 0);
    expect(result.id).toBe('MRD-001');

    const content = readFileSync(join(root, result.path), 'utf8');
    expect(content).toContain('Nuevo contenido del mercado.');
    expect(content).toContain('revisado');
    expect(content).toMatch(/status: "approved"/);
  });

  test('an update draft becomes stale once the underlying file changes before commit', async () => {
    const view = await authoring.draft({ kind: 'ART', title: 'Llamada con cliente (editada)', body: 'Contenido editado.', updateId: 'ART-001' });
    expect(view.validation.ok).toBe(true);

    // Someone else edits and commits the same document out from under the open draft.
    await engine.transaction(
      async (ops) => {
        await ops.updateDocument('ART-001', { title: 'Llamada con cliente (otro cambio)' });
        await ops.refresh();
      },
      { atomic: true },
    );

    const revalidated = await authoring.validate(view.draftId);
    expect(revalidated.validation.ok).toBe(false);
    expect(revalidated.validation.issues.map((i) => i.code)).toContain('stale_base');
    await expect(authoring.commit(view.draftId, 0)).rejects.toThrow(DraftValidationError);
    authoring.discard(view.draftId);
  });
});

class FlakyStore implements GraphStore {
  failNextWrite = false;
  constructor(private readonly inner: GraphStore) {}
  clear(): Promise<void> {
    return this.inner.clear();
  }
  async writeSnapshot(snapshot: GraphSnapshot): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('simulated store outage');
    }
    return this.inner.writeSnapshot(snapshot);
  }
  getNode(id: string): Promise<NodeDetail | null> {
    return this.inner.getNode(id);
  }
  search(text: string, options?: { labels?: NodeLabel[]; limit?: number }): Promise<SearchHit[]> {
    return this.inner.search(text, options);
  }
  branch(id: string): Promise<Subgraph> {
    return this.inner.branch(id);
  }
  fullGraph(): Promise<Subgraph> {
    return this.inner.fullGraph();
  }
  listWorkOrders(filter?: { status?: string; blueprint?: string }): Promise<WorkOrderSummary[]> {
    return this.inner.listWorkOrders(filter);
  }
  workOrderContext(id: string): Promise<WorkOrderContextRaw | null> {
    return this.inner.workOrderContext(id);
  }
  metricsRaw(): Promise<MetricsRaw> {
    return this.inner.metricsRaw();
  }
}

describe('atomic commit rollback', () => {
  let rbRoot: string;
  let rbConfig: PrdmConfig;
  let rbDb: Neo4jGraphDatabase;
  let flaky: FlakyStore;
  let rbEngine: Engine;
  let rbAuthoring: AuthoringService;

  beforeAll(async () => {
    rbRoot = createFixtureRepo();
    rbConfig = testConfig(rbRoot);
    const opened = await openTestDb(rbConfig);
    rbDb = opened.db;
    flaky = new FlakyStore(opened.store);
    rbEngine = new Engine(rbConfig, flaky);
    await rbEngine.refresh();
    rbAuthoring = new AuthoringService({ engine: rbEngine, drafts: new DraftStore(rbConfig.authoring) });
  });

  afterAll(async () => {
    await rbDb?.close();
    if (rbRoot) removeDir(rbRoot);
  });

  test('a failing writeSnapshot rolls back file writes, keeps the draft, and marks the graph stale', async () => {
    const baselineBefore = readFileSync(join(rbRoot, '.prdm/baseline.json'));
    const mrdBefore = readFileSync(join(rbRoot, 'docs/mrd/MRD-001.md'), 'utf8');

    const createView = await rbAuthoring.draft({ kind: 'FB', title: 'Rollback me', body: 'this should never land' });
    const updateView = await rbAuthoring.draft({ kind: 'MRD', title: 'Mercado (temporal)', body: 'temporal body', updateId: 'MRD-001' });

    flaky.failNextWrite = true;
    await expect(rbAuthoring.commit(createView.draftId, 0)).rejects.toThrow(/simulated store outage/);

    // the create draft's file must not exist (its containing directory may, since mkdir isn't journaled/rolled back)
    expect(existsSync(join(rbRoot, 'docs/feedback/FB-001-rollback-me.md'))).toBe(false);
    // baseline is byte-identical: writeSnapshot is attempted before saveBaseline
    expect(readFileSync(join(rbRoot, '.prdm/baseline.json'))).toEqual(baselineBefore);
    // the draft is still open (commit did not consume it)
    expect(rbAuthoring.list().some((d) => d.draftId === createView.draftId)).toBe(true);
    expect(await graphStaleMarkerExists(rbRoot)).toBe(true);

    // an unrelated, still-open update draft (never committed by the failed transaction) is unaffected.
    const revalidated = await rbAuthoring.validate(updateView.draftId);
    expect(revalidated.validation.ok).toBe(true);
    expect(readFileSync(join(rbRoot, 'docs/mrd/MRD-001.md'), 'utf8')).toBe(mrdBefore);

    // the next refresh, once the store is healthy again, clears the stale marker.
    await rbEngine.refresh();
    expect(await graphStaleMarkerExists(rbRoot)).toBe(false);

    rbAuthoring.discard(createView.draftId);
    rbAuthoring.discard(updateView.draftId);
  });
});

describe('orphan journal recovery', () => {
  let orphanRoot: string;
  let orphanConfig: PrdmConfig;
  let orphanDb: Neo4jGraphDatabase;
  let orphanStore: GraphStore;
  let orphanEngine: Engine;

  beforeAll(async () => {
    orphanRoot = createFixtureRepo();
    orphanConfig = testConfig(orphanRoot);
    ({ db: orphanDb, store: orphanStore } = await openTestDb(orphanConfig));
    orphanEngine = new Engine(orphanConfig, orphanStore);
    await orphanEngine.refresh();
  });

  afterAll(async () => {
    await orphanDb?.close();
    if (orphanRoot) removeDir(orphanRoot);
  });

  afterEach(async () => {
    // leave the marker cleared between the two tests in this block
    await orphanEngine.refresh();
  });

  test('a journal left by a dead pid on the same host is rolled back on the next transaction, and the graph is refreshed', async () => {
    const mrdPath = join(orphanRoot, 'docs/mrd/MRD-001.md');
    const original = readFileSync(mrdPath, 'utf8');

    mkdirSync(join(orphanRoot, '.prdm'), { recursive: true });
    const token = 'dead-owner-integration';
    writeFileSync(
      join(orphanRoot, `.prdm/journal-${token}.json`),
      JSON.stringify({ owner: { token, pid: 2_147_483_000, host: hostname() }, entries: [{ path: 'docs/mrd/MRD-001.md', kind: 'replaced', original: Buffer.from(original).toString('base64') }] }),
    );
    writeFileSync(mrdPath, 'mutated by the crashed process\n');

    await orphanEngine.refresh();

    expect(readFileSync(mrdPath, 'utf8')).toBe(original);
    expect(existsSync(join(orphanRoot, `.prdm/journal-${token}.json`))).toBe(false);
  });
});
