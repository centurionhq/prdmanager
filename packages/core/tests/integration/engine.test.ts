import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PrdmConfig } from '../../src/config.js';
import { Engine } from '../../src/engine.js';
import type { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphStore, MetricsRaw } from '../../src/graph/types.js';
import { computeMetrics } from '../../src/metrics/metrics.js';
import { buildForest, renderMermaid, renderText } from '../../src/graph/tree.js';
import { sha256 } from '../../src/util/hash.js';
import { graphStaleMarkerExists, writeJournalForTest } from '../../src/util/journal.js';
import { commitAll, createFixtureRepo, makeTmpDir, openTestDb, removeDir, testConfig, writeFiles } from '@prdm/testkit';

// Isolate the journal HMAC key (WO-023 finding 1) from the developer's real ~/.config/prdm/journal.key.
process.env.PRDM_JOURNAL_KEY_FILE ??= `${makeTmpDir('prdm-journal-key-')}/journal.key`;

/** Spins up an isolated fixture repo + Engine + Neo4j test db for a single test, and always tears both down. */
async function withEngine<T>(fn: (engine: Engine, root: string) => Promise<T>): Promise<T> {
  const root = createFixtureRepo();
  const config = testConfig(root);
  const { db, store } = await openTestDb(config);
  const engine = new Engine(config, store);
  await engine.refresh();
  try {
    return await fn(engine, root);
  } finally {
    await db.close();
    removeDir(root);
  }
}

/** Repo + db aislados; `prepare` edita el repo antes del refresh y `refresh: false` deja el proyecto sin nodos. */
async function withMetrics(opts: { prepare?: (root: string) => void; refresh?: boolean }): Promise<MetricsRaw> {
  const root = createFixtureRepo();
  opts.prepare?.(root);
  const config = testConfig(root);
  const { db, store } = await openTestDb(config);
  try {
    if (opts.refresh !== false) await new Engine(config, store).refresh();
    return await store.metricsRaw();
  } finally {
    await db.close();
    removeDir(root);
  }
}

let root: string;
let config: PrdmConfig;
let db: Neo4jGraphDatabase;
let store: GraphStore;
let engine: Engine;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
});

afterAll(async () => {
  await db?.close();
  if (root) removeDir(root);
});

describe('Engine + Neo4jGraphStore', () => {
  test('first refresh indexes the repository into Neo4j with no drift', async () => {
    const report = await engine.refresh();
    expect(report.errors).toEqual([]);
    // The fixture's SDD-001 still uses the deprecated `governs` alias, and MRD-001/WO-001 predate PRD-002's
    // lifecycle rules (no `justified_by`/`source_task`); fixture.ts is shared and not owned by this WO.
    expect(report.issues.filter((i) => i.kind !== 'lifecycle_violation')).toEqual([
      { kind: 'deprecated_field', severity: 'warning', nodeId: 'SDD-001', message: expect.stringContaining('impacts_paths') },
    ]);
    expect(report.documents).toBe(6);
    expect(report.baselineWritten).toBe(true);

    const sdd = await store.getNode('SDD-001');
    expect(sdd?.node).toMatchObject({ id: 'SDD-001', label: 'Blueprint', title: 'Arquitectura del Sync Monitor' });
    expect(sdd?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ARCHITECTS', direction: 'out', ref: 'PRD-001' }),
        expect.objectContaining({ type: 'IMPLEMENTS', direction: 'in', ref: 'WO-001' }),
        expect.objectContaining({ type: 'GOVERNED_BY', direction: 'in', ref: 'code:src/sync/monitor.ts', props: expect.objectContaining({ status: 'synced' }) }),
      ]),
    );
    const wo = await store.getNode('WO-001');
    expect(wo?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ASSIGNED_TO', direction: 'out', ref: 'actor:agent:claude' }),
        expect.objectContaining({ type: 'RESOLVES', direction: 'in' }),
      ]),
    );
    expect(await store.getNode('PRD-404')).toBeNull();
  });

  test('reconstructs the full branch of a work order from the root down to code', async () => {
    const forest = buildForest(await store.branch('WO-001'));
    expect(forest.map((n) => n.ref)).toEqual(['MRD-001']);
    const text = renderText(forest);
    expect(text).toMatch(/MRD-001[\s\S]*PRD-001[\s\S]*SDD-001[\s\S]*WO-001[\s\S]*commit:/);
    // ART-001 now legitimately appears here too: it JUSTIFIED_BYs PRD-001 (WO-019), and JUSTIFIED_BY is part of
    // branch()'s traversal filter, same as the dedicated PRD-001 branch assertion below.
    expect(text).toContain('ART-001');

    const prdBranch = buildForest(await store.branch('PRD-001'));
    const prdText = renderText(prdBranch);
    expect(prdText).toContain('ART-001');
    expect(prdText).toContain('code:src/sync/monitor.ts');
    expect(renderMermaid(prdBranch)).toMatch(/^flowchart TD/);
    expect(await store.branch('PRD-404')).toEqual({ nodes: [], edges: [] });
  });

  test('full-text search finds documents by content and filters by label', async () => {
    const hits = await store.search('desincronización', { labels: ['Feature'], limit: 5 });
    expect(hits[0]).toMatchObject({ id: 'PRD-001', label: 'Feature' });
    expect(await store.search('drift', { labels: ['Blueprint'], limit: 5 })).toEqual([]);
  });

  test('blueprint change marks work orders and code out of sync, acknowledge restores sync', async () => {
    const sddPath = join(root, 'docs/blueprints/SDD-001.md');
    writeFiles(root, { 'docs/blueprints/SDD-001.md': readFileSync(sddPath, 'utf8').replace('compara hashes', 'compara hashes y firmas') });

    const drift = await engine.refresh();
    expect(drift.issues.filter((i) => !['deprecated_field', 'lifecycle_violation'].includes(i.kind)).map((i) => i.kind)).toEqual([
      'blueprint_changed',
      'code_out_of_sync',
      'work_order_out_of_sync',
    ]);
    expect(drift.workOrderUpdates).toEqual([{ id: 'WO-001', sourcePath: 'docs/work-orders/WO-001.md', from: 'done', to: 'out_of_sync' }]);
    expect(readFileSync(join(root, 'docs/work-orders/WO-001.md'), 'utf8')).toContain('status: "out_of_sync"');
    expect((await store.getNode('WO-001'))?.node.status).toBe('out_of_sync');
    const sdd = await store.getNode('SDD-001');
    expect(sdd?.links.find((l) => l.type === 'GOVERNED_BY')?.props).toMatchObject({ status: 'out_of_sync', reason: 'blueprint_changed' });

    const blueprintAcked = await engine.acknowledge('SDD-001');
    expect(blueprintAcked.issues.filter((i) => !['deprecated_field', 'lifecycle_violation'].includes(i.kind)).map((i) => [i.kind, i.nodeId])).toEqual([['work_order_out_of_sync', 'WO-001']]);
    expect((await store.getNode('WO-001'))?.node.status).toBe('out_of_sync');

    await expect(engine.acknowledge('WO-404')).rejects.toThrow(/unknown/);
    const acked = await engine.acknowledge('WO-001');
    expect(acked.issues.filter((i) => !['deprecated_field', 'lifecycle_violation'].includes(i.kind))).toEqual([]);
    expect((await store.getNode('WO-001'))?.node.status).toBe('done');
    expect(readFileSync(join(root, 'docs/work-orders/WO-001.md'), 'utf8')).toMatch(/blueprint_hashes: \{"SDD-001":"[0-9a-f]{64}"\}/);
  });

  test('code change is out of sync until committed with a Refs trailer of a done work order', async () => {
    writeFiles(root, { 'src/sync/monitor.ts': 'export function detect() {\n  return 2;\n}\n' });
    const dirty = await engine.refresh();
    expect(dirty.issues.filter((i) => !['deprecated_field', 'lifecycle_violation'].includes(i.kind)).map((i) => [i.kind, i.target])).toEqual([['code_out_of_sync', 'src/sync/monitor.ts']]);

    commitAll(root, 'fix: detect returns 2\n\nRefs: WO-001');
    const committed = await engine.refresh();
    expect(committed.issues.filter((i) => !['deprecated_field', 'lifecycle_violation'].includes(i.kind))).toEqual([]);
    expect(committed.governed.find((g) => g.key === 'src/sync/monitor.ts')?.reason).toBe('resolved_by_commit');
  });

  test('removing a document removes its node and reports the resulting broken link', async () => {
    rmSync(join(root, 'docs/artifacts/ART-001.md'));
    writeFiles(root, { 'docs/feedback/FB-001.md': '---\nid: FB-001\ntype: FB\ntitle: x\nsource: email\ninforms: [PRD-404]\n---\nx\n' });
    const report = await engine.refresh();
    expect(await store.getNode('ART-001')).toBeNull();
    // BC-001 (fixture.ts, PRD-011/SDD-022) is justified_by ART-001 too, so removing it breaks that link as well.
    expect(report.issues.filter((i) => !['deprecated_field', 'lifecycle_violation'].includes(i.kind)).map((i) => [i.kind, i.nodeId])).toEqual([
      ['broken_link', 'BC-001'],
      ['broken_link', 'FB-001'],
    ]);
    expect(report.hasBlockingIssues).toBe(true);
  });

  test('computes success metrics from the graph', async () => {
    const metrics = await store.metricsRaw();
    expect(metrics.governedTotal).toBe(1);
    expect(metrics.governedSynced).toBe(1);
    // BC-001 no tiene blueprint propio, pero su PRD hijo PRD-001 (PRD-001 -[JUSTIFIED_BY]-> BC-001) lo arquitecta
    // SDD-001 con código gobernado: el linaje simétrico lo cuenta como trazado (predicción de FB-058).
    expect(metrics.featuresTotal).toBe(3);
    expect(metrics.featuresTraced).toBe(3);
    expect(metrics.orphanFeatures).toEqual([]);
    expect(metrics.commitsTotal).toBe(2);
    expect(metrics.commitsTraced).toBe(2);
    expect(metrics.workOrders).toEqual([{ id: 'WO-001', status: 'done', assignedTo: 'agent:claude', createdAt: null, claimedAt: '2026-09-10T10:00:00.000Z', completedAt: '2026-09-10T14:00:00.000Z' }]);
  });
});

describe('SDD-079 orphanFeatures', () => {
  test('empty project: 0 = 0 + 0 and a null percent', async () => {
    const raw = await withMetrics({ refresh: false });
    expect(raw.featuresTotal).toBe(0);
    expect(raw.featuresTraced).toBe(0);
    expect(raw.orphanFeatures).toEqual([]);
    expect(computeMetrics(raw).traceability.featurePercent).toBeNull();
    expect(raw.featuresTraced + raw.orphanFeatures.length).toBe(raw.featuresTotal);
  });

  test('every feature is an orphan when no blueprint exists', async () => {
    const raw = await withMetrics({ prepare: (r) => rmSync(join(r, 'docs/blueprints/SDD-001.md')) });
    expect(raw.featuresTotal).toBe(3);
    expect(raw.featuresTraced).toBe(0);
    expect(raw.orphanFeatures.map((f) => f.id)).toEqual(['BC-001', 'MRD-001', 'PRD-001']);
    expect(computeMetrics(raw).traceability.featurePercent).toBe(0);
    expect(raw.featuresTraced + raw.orphanFeatures.length).toBe(raw.featuresTotal);
  });

  test('mixed: a BC without lineage is the only orphan; BC-001 is traced through its child PRD (FB-058)', async () => {
    const raw = await withMetrics({
      prepare: (r) =>
        writeFiles(r, {
          'docs/business-case/BC-003.md': '---\nid: BC-003\ntype: BC\ntitle: "Sin linaje"\nstatus: approved\njustified_by: ["ART-001"]\n---\nx\n',
        }),
    });
    expect(raw.featuresTotal).toBe(4);
    expect(raw.featuresTraced).toBe(3);
    expect(raw.orphanFeatures.map((f) => f.id)).toEqual(['BC-003']);
    expect(raw.orphanFeatures[0]).toEqual({ id: 'BC-003', kind: 'BC', title: 'Sin linaje', status: 'approved' });
    expect(raw.orphanFeatures.map((f) => f.id)).not.toContain('BC-001');
    expect(raw.featuresTraced + raw.orphanFeatures.length).toBe(raw.featuresTotal);
  });
});

describe('WO-023 hardening', () => {
  test('finding 2: creating a document at a path that already exists (no frontmatter) fails and leaves the file untouched', async () => {
    await withEngine(async (engine, root) => {
      const collidePath = join(root, 'docs/collide.md');
      writeFileSync(collidePath, 'not a prdm document, just some text\n');

      await expect(
        engine.transaction(async (ops) => {
          await ops.createDocument('docs/collide.md', '---\nid: FB-900\ntype: FB\ntitle: x\nsource: email\nroot: true\n---\nbody\n');
        }, { atomic: true }),
      ).rejects.toThrow(/already exists/);

      expect(readFileSync(collidePath, 'utf8')).toBe('not a prdm document, just some text\n');
    });
  });

  test('finding 4: a rollback failure is surfaced as an AggregateError (preserving the original error) and still marks the graph stale', async () => {
    if (process.getuid?.() === 0) return; // permission-based sabotage below has no effect when running as root
    await withEngine(async (engine, root) => {
      const mrdDir = join(root, 'docs/mrd');

      let caught: unknown;
      try {
        await engine.transaction(async (ops) => {
          await ops.updateDocument('MRD-001', { title: 'Renamed mid-flight' });
          // Sabotage the journaled replace's rollback: the file's content still matches what we wrote (so
          // the finding-2 hash guard lets it through), but its directory is no longer writable, so restoring
          // the pre-image (which needs to create a temp file there first) genuinely fails.
          chmodSync(mrdDir, 0o500);
          throw new Error('boom: simulated failure after the write');
        }, { atomic: true });
      } catch (err) {
        caught = err;
      } finally {
        chmodSync(mrdDir, 0o755);
      }

      expect(caught).toBeInstanceOf(AggregateError);
      const agg = caught as AggregateError;
      expect(agg.message).toContain('boom');
      expect(agg.errors).toHaveLength(2);
      expect((agg.errors[0] as Error).message).toContain('boom');
      expect(await graphStaleMarkerExists(root)).toBe(true);
    });
  });

  test('finding 10: engine.recover() is a cheap no-op (never touches the repo lock) when nothing is pending', async () => {
    await withEngine(async (engine, root) => {
      // Plant a fresh, non-stale lock: if recover() actually tried to acquire it, it would block for a long time.
      mkdirSync(join(root, '.prdm'), { recursive: true });
      const lockPath = join(root, '.prdm/engine.lock');
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, host: 'unrelated-host', createdAt: new Date().toISOString() }));

      const start = Date.now();
      const result = await engine.recover();

      expect(result).toEqual({ recovered: false, warnings: [] });
      expect(Date.now() - start).toBeLessThan(2_000);
      expect(existsSync(lockPath)).toBe(true); // untouched: recover() never attempted to acquire it
    });
  });

  test('finding 10: engine.recover() rolls back a leftover authenticated journal and reports recovered: true', async () => {
    await withEngine(async (engine, root) => {
      const mrdPath = join(root, 'docs/mrd/MRD-001.md');
      const original = readFileSync(mrdPath, 'utf8');
      const token = 'leftover-for-recover';
      await writeJournalForTest(root, {
        owner: { token, pid: 2_147_483_000, host: hostname() },
        entries: [{ path: 'docs/mrd/MRD-001.md', kind: 'replaced', sha256: sha256('mutated\n'), original: Buffer.from(original).toString('base64') }],
      });
      writeFileSync(mrdPath, 'mutated\n');

      const result = await engine.recover();

      expect(result.recovered).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(readFileSync(mrdPath, 'utf8')).toBe(original);
      expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(false);
    });
  });
});
