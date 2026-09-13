import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Engine } from '../../src/engine.js';
import type { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphStore } from '../../src/graph/types.js';
import type { PrdmConfig } from '../../src/config.js';
import { createFixtureRepo, doc, openTestDb, prd, removeDir, testConfig } from '@prdm/testkit';

let rootA: string;
let rootB: string;
let configA: PrdmConfig;
let configB: PrdmConfig;
let dbA: Neo4jGraphDatabase;
let dbB: Neo4jGraphDatabase;
let storeA: GraphStore;
let storeB: GraphStore;

beforeAll(async () => {
  rootA = createFixtureRepo();
  rootB = createFixtureRepo();
  configA = testConfig(rootA);
  configB = testConfig(rootB);
  // Two different checkouts get two different project ids (config.ts derives them from the realpath).
  expect(configA.project.id).not.toBe(configB.project.id);

  ({ db: dbA, store: storeA } = await openTestDb(configA));
  ({ db: dbB, store: storeB } = await openTestDb(configB));

  await new Engine(configA, storeA).refresh();
  await new Engine(configB, storeB).refresh();
});

afterAll(async () => {
  await dbA?.close();
  await dbB?.close();
  if (rootA) removeDir(rootA);
  if (rootB) removeDir(rootB);
});

describe('multi-project isolation (SDD-002 "Grafo multi-proyecto")', () => {
  test('both projects index the same fixture ids into disjoint partitions', async () => {
    expect((await storeA.getNode('PRD-001'))?.node.id).toBe('PRD-001');
    expect((await storeB.getNode('PRD-001'))?.node.id).toBe('PRD-001');
  });

  test('getNode never returns the other project\'s node', async () => {
    // Same fixture in both, so this only proves isolation if each project's copy is independently addressable
    // and one going missing does not affect the other (checked below after a mutation).
    const a = await storeA.getNode('WO-001');
    const b = await storeB.getNode('WO-001');
    expect(a?.node.id).toBe('WO-001');
    expect(b?.node.id).toBe('WO-001');
  });

  test('search is scoped per project', async () => {
    const hitsA = await storeA.search('desincronización', { labels: ['Feature'] });
    const hitsB = await storeB.search('desincronización', { labels: ['Feature'] });
    expect(hitsA.map((h) => h.id)).toEqual(['PRD-001']);
    expect(hitsB.map((h) => h.id)).toEqual(['PRD-001']);
  });

  test('branch, fullGraph, listWorkOrders, workOrderContext and metricsRaw are scoped per project', async () => {
    const branchA = await storeA.branch('WO-001');
    expect(branchA.nodes.map((n) => n.ref)).toEqual(expect.arrayContaining(['MRD-001', 'PRD-001', 'SDD-001', 'WO-001']));

    const fullA = await storeA.fullGraph();
    const fullB = await storeB.fullGraph();
    expect(fullA.nodes.length).toBe(fullB.nodes.length);

    expect((await storeA.listWorkOrders()).map((w) => w.id)).toEqual(['WO-001']);
    expect((await storeB.listWorkOrders()).map((w) => w.id)).toEqual(['WO-001']);

    expect((await storeA.workOrderContext('WO-001'))?.blueprints.map((b) => b.id)).toEqual(['SDD-001']);

    const metricsA = await storeA.metricsRaw();
    const metricsB = await storeB.metricsRaw();
    expect(metricsA.featuresTotal).toBe(2);
    expect(metricsB.featuresTotal).toBe(2);
  });

  test('the same id can exist unique per project (composite constraint), and mutating B never touches A', async () => {
    const beforeA = (await storeA.fullGraph()).nodes.length;

    // Delete ART-001 from B only, then refresh B; A's node count and content must be untouched.
    const { rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    rmSync(join(rootB, 'docs/artifacts/ART-001.md'));
    await new Engine(configB, storeB).refresh();

    expect(await storeB.getNode('ART-001')).toBeNull();
    expect(await storeA.getNode('ART-001')).not.toBeNull();
    expect((await storeA.fullGraph()).nodes.length).toBe(beforeA);
  });

  test('Lucene project scoping does not leak across ids that share a long common prefix (ADR-002 D5)', async () => {
    const idBase = 'prj_aaaaaaaaaaaaaaa';
    const idOne = `${idBase}1`;
    const idTwo = `${idBase}2`;
    const projectOne = { id: idOne, name: 'one', root: '/tmp/prefix-one' };
    const projectTwo = { id: idTwo, name: 'two', root: '/tmp/prefix-two' };
    const oneStore = dbA.forProject(projectOne);
    const twoStore = dbA.forProject(projectTwo);
    try {
      await oneStore.writeSnapshot({ docs: [doc('id: PRD-777\ntype: PRD\ntitle: "Uniqueterm sharedterm one"', 'x')], governed: [], reviewNeeded: [], commits: [] });
      await twoStore.writeSnapshot({ docs: [doc('id: PRD-778\ntype: PRD\ntitle: "Otherterm sharedterm two"', 'x')], governed: [], reviewNeeded: [], commits: [] });

      expect((await oneStore.search('uniqueterm')).map((h) => h.id)).toEqual(['PRD-777']);
      expect((await twoStore.search('uniqueterm')).map((h) => h.id)).toEqual([]);
      expect((await oneStore.search('sharedterm')).map((h) => h.id)).toEqual(['PRD-777']);
      expect((await twoStore.search('sharedterm')).map((h) => h.id)).toEqual(['PRD-778']);
    } finally {
      await oneStore.clear();
      await twoStore.clear();
    }
  });
});

describe('project root fingerprint (SDD-002 "Proyecto activo", ADR-002 D6)', () => {
  test('writeSnapshot rejects a root mismatch for an already-bound project id, and deletes nothing', async () => {
    const sharedId = 'prj_ffffffffffffffff';
    const boundStore = dbA.forProject({ id: sharedId, name: 'shared', root: '/checkouts/one' });
    const impostorStore = dbA.forProject({ id: sharedId, name: 'shared', root: '/checkouts/two' });
    try {
      await boundStore.writeSnapshot({ docs: [prd()], governed: [], reviewNeeded: [], commits: [] });
      expect((await boundStore.getNode('PRD-001'))?.node.id).toBe('PRD-001');

      await expect(
        impostorStore.writeSnapshot({ docs: [prd('changed')], governed: [], reviewNeeded: [], commits: [] }),
      ).rejects.toThrow(/is bound to \/checkouts\/one/);

      // Nothing was deleted by the rejected attempt.
      expect((await boundStore.getNode('PRD-001'))?.node.id).toBe('PRD-001');
    } finally {
      await boundStore.clear();
    }
  });

  test('clear() rejects a root mismatch for an already-bound project id, and deletes nothing (prdm db reset)', async () => {
    const sharedId = 'prj_eeeeeeeeeeeeeeee';
    const boundStore = dbA.forProject({ id: sharedId, name: 'shared', root: '/checkouts/reset-one' });
    const impostorStore = dbA.forProject({ id: sharedId, name: 'shared', root: '/checkouts/reset-two' });
    try {
      await boundStore.writeSnapshot({ docs: [prd()], governed: [], reviewNeeded: [], commits: [] });
      expect((await boundStore.getNode('PRD-001'))?.node.id).toBe('PRD-001');

      await expect(impostorStore.clear()).rejects.toThrow(/is bound to \/checkouts\/reset-one/);

      // The first checkout's nodes survive the rejected reset from the second.
      expect((await boundStore.getNode('PRD-001'))?.node.id).toBe('PRD-001');
    } finally {
      await boundStore.clear();
    }
  });

  test('clear() on a project with no Project node yet (never synced) does not throw', async () => {
    const freshStore = dbA.forProject({ id: 'prj_dddddddddddddddd', name: 'fresh', root: '/checkouts/fresh' });
    await expect(freshStore.clear()).resolves.toBeUndefined();
  });
});
