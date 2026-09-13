import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DOC_KINDS, Engine, type GraphStore } from '@prdm/core';
import { createFixtureRepo, removeDir, testConfig } from '@prdm/testkit';
import { buildWebProjectSummary } from '../../src/summary.js';

// This suite never opens Neo4j: `buildWebProjectSummary` only reads documents off disk (`scanDocuments`), so the
// `engine` in its deps is a typed placeholder whose store methods are never called (mirrors SDD-005's "Ciclo de
// vida del Engine": this package never refreshes/recovers on its own).
const unusedStore = {} as unknown as GraphStore;

let root: string;

beforeEach(() => {
  root = createFixtureRepo();
});

afterEach(() => {
  removeDir(root);
});

describe('buildWebProjectSummary', () => {
  test('reports id, name, folders, lifecycle and per-kind counts without any authoring fields', async () => {
    const config = testConfig(root);
    const engine = new Engine(config, unusedStore);

    const summary = await buildWebProjectSummary({ config, engine });

    expect(summary.id).toBe(config.project.id);
    expect(summary.name).toBe(config.project.name);
    expect(summary.folders).toEqual(config.folders);
    for (const kind of DOC_KINDS) expect(summary.lifecycle).toHaveProperty(kind);
    expect(summary).not.toHaveProperty('openDrafts');
    expect(summary).not.toHaveProperty('draftableKinds');
  });

  test('counts documents by kind from the fixture repo', async () => {
    const config = testConfig(root);
    const engine = new Engine(config, unusedStore);

    const { counts } = await buildWebProjectSummary({ config, engine });

    // FIXTURE_FILES seeds exactly one MRD, one PRD (Feature kinds), one SDD (Blueprint), one WO, one ART.
    expect(counts.MRD).toBe(1);
    expect(counts.PRD).toBe(1);
    expect(counts.SDD).toBe(1);
    expect(counts.WO).toBe(1);
    expect(counts.ART).toBe(1);
    expect(counts.FR).toBe(0);
    expect(counts.ADR).toBe(0);
    expect(counts.FB).toBe(0);
  });
});
