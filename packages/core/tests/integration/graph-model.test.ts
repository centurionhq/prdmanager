import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import neo4j, { type Driver } from 'neo4j-driver';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Engine } from '../../src/engine.js';
import { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphStore } from '../../src/graph/types.js';
import type { PrdmConfig } from '../../src/config.js';
import { createFixtureRepo, openTestDb, removeDir, testConfig } from '@prdm/testkit';

/**
 * WO-022 (ADR-002 tarea "Validar el modelo multi-proyecto con neo4j-data-modeling y actualizar
 * docs/model/graph-model.json"): keeps docs/model/graph-model.json honest by checking it against the real
 * schema (SHOW CONSTRAINTS / SHOW INDEXES after running the real migrations) and the real data a refresh
 * writes (labels, relationship types and per-label property keys), instead of relying on a human to update
 * the doc by hand every time migrations.ts/queries.ts/frontmatter.ts changes.
 */

interface ModelProperty {
  name: string;
}

interface ModelNodeMetadata {
  abstractBase?: boolean;
  baseLabel?: string;
}

interface ModelNode {
  label: string;
  key_property: ModelProperty;
  properties: ModelProperty[];
  metadata?: ModelNodeMetadata;
}

interface ModelRelationship {
  type: string;
  start_node_label: string;
  end_node_label: string;
}

interface ModelConstraint {
  name: string;
  label: string;
  properties: string[];
}

interface ModelIndex {
  name: string;
  type: 'RANGE' | 'FULLTEXT';
  label: string;
  properties: string[];
  analyzer?: string;
}

interface GraphModel {
  nodes: ModelNode[];
  relationships: ModelRelationship[];
  'x-prdm': { constraints: ModelConstraint[]; indexes: ModelIndex[] };
}

const MODEL_PATH = resolve(import.meta.dirname, '../../../../docs/model/graph-model.json');
const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8')) as GraphModel;

const config = testConfig(process.cwd());
let rawDriver: Driver;

async function showConstraints(): Promise<{ name: string; type: string; label: string; properties: string[] }[]> {
  const { records } = await rawDriver.executeQuery(
    'SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties RETURN name, type, labelsOrTypes, properties',
    {},
    { database: config.neo4j.database },
  );
  return records.map((r) => ({
    name: r.get('name') as string,
    type: r.get('type') as string,
    label: (r.get('labelsOrTypes') as string[])[0]!,
    properties: r.get('properties') as string[],
  }));
}

/** Excludes the backing range index Neo4j auto-creates for every uniqueness constraint (same name as the constraint, `owningConstraint` set): those aren't declared separately in x-prdm.indexes. */
async function showOwnIndexes(): Promise<{ name: string; type: string; label: string; properties: string[]; options: unknown }[]> {
  const { records } = await rawDriver.executeQuery(
    'SHOW INDEXES YIELD name, type, labelsOrTypes, properties, options, owningConstraint WHERE owningConstraint IS NULL RETURN name, type, labelsOrTypes, properties, options',
    {},
    { database: config.neo4j.database },
  );
  return records.map((r) => ({
    name: r.get('name') as string,
    type: r.get('type') as string,
    label: (r.get('labelsOrTypes') as string[])[0]!,
    properties: r.get('properties') as string[],
    options: r.get('options'),
  }));
}

beforeAll(() => {
  rawDriver = neo4j.driver(config.neo4j.uri, neo4j.auth.basic(config.neo4j.username, config.neo4j.password), { disableLosslessIntegers: true });
});

afterAll(async () => {
  await rawDriver?.close();
});

describe('docs/model/graph-model.json vs. the real schema (SHOW CONSTRAINTS / SHOW INDEXES)', () => {
  beforeAll(async () => {
    const db = Neo4jGraphDatabase.connect(config.neo4j);
    try {
      await db.verify();
      await db.migrate();
    } finally {
      await db.close();
    }
  });

  test('every modeled constraint exists with the modeled label/properties, and no undocumented constraint exists', async () => {
    const constraints = await showConstraints();
    for (const expected of model['x-prdm'].constraints) {
      const actual = constraints.find((c) => c.name === expected.name);
      expect(actual, `constraint "${expected.name}" declared in graph-model.json is missing from the database`).toBeDefined();
      expect(actual!.type).toBe('NODE_PROPERTY_UNIQUENESS');
      expect(actual!.label).toBe(expected.label);
      expect(actual!.properties).toEqual(expected.properties);
    }
    expect(constraints.map((c) => c.name).sort()).toEqual(model['x-prdm'].constraints.map((c) => c.name).sort());
  });

  test('every modeled index (range + fulltext) exists with the modeled label/properties/analyzer, and no undocumented index exists', async () => {
    const indexes = await showOwnIndexes();
    for (const expected of model['x-prdm'].indexes) {
      const actual = indexes.find((i) => i.name === expected.name);
      expect(actual, `index "${expected.name}" declared in graph-model.json is missing from the database`).toBeDefined();
      expect(actual!.type).toBe(expected.type);
      expect(actual!.label).toBe(expected.label);
      expect(actual!.properties).toEqual(expected.properties);
      if (expected.type === 'FULLTEXT') {
        const options = actual!.options as { indexConfig?: Record<string, unknown> } | null;
        expect(options?.indexConfig?.['fulltext.analyzer']).toBe(expected.analyzer);
      }
    }
    expect(indexes.map((i) => i.name).sort()).toEqual(model['x-prdm'].indexes.map((i) => i.name).sort());
  });
});

describe('docs/model/graph-model.json vs. what a real refresh writes (labels, relationship types, property keys)', () => {
  let root: string;
  let projectConfig: PrdmConfig;
  let db: Neo4jGraphDatabase;
  let store: GraphStore;

  beforeAll(async () => {
    root = createFixtureRepo();
    projectConfig = testConfig(root);
    ({ db, store } = await openTestDb(projectConfig));
    await new Engine(projectConfig, store).refresh();
  });

  afterAll(async () => {
    await db?.close();
    if (root) removeDir(root);
  });

  test('every label observed in the database is declared as a node in the model', async () => {
    const { records } = await rawDriver.executeQuery('CALL db.labels() YIELD label RETURN label', {}, { database: config.neo4j.database });
    const observed = records.map((r) => r.get('label') as string);
    const modeled = new Set(model.nodes.map((n) => n.label));
    expect(observed.length).toBeGreaterThan(0);
    for (const label of observed) expect(modeled.has(label), `label :${label} exists in the database but is not declared in graph-model.json`).toBe(true);
  });

  test('every relationship type observed in the database is declared in the model', async () => {
    const { records } = await rawDriver.executeQuery('CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType', {}, { database: config.neo4j.database });
    const observed = records.map((r) => r.get('relationshipType') as string);
    const modeled = new Set(model.relationships.map((r) => r.type));
    expect(observed.length).toBeGreaterThan(0);
    for (const type of observed) expect(modeled.has(type), `relationship type :${type} exists in the database but is not declared in graph-model.json`).toBe(true);
  });

  test('every property key on sampled nodes of each label is declared for that label (or its :Node base) in the model', async () => {
    const baseNode = model.nodes.find((n) => n.metadata?.abstractBase);
    expect(baseNode, 'graph-model.json must declare an abstract :Node base entry').toBeDefined();
    const baseKeys = new Set([baseNode!.key_property.name, ...baseNode!.properties.map((p) => p.name)]);

    let sampledAnyLabel = false;
    for (const node of model.nodes) {
      if (node.metadata?.abstractBase) continue; // :Node is never a node's only label; its keys are covered via subtype samples below.

      const { records } = await rawDriver.executeQuery(
        `MATCH (n:${node.label} {project_id: $projectId}) RETURN keys(n) AS keys LIMIT 25`,
        { projectId: projectConfig.project.id },
        { database: config.neo4j.database },
      );
      if (records.length === 0) continue; // Not every label is populated by this fixture (e.g. no Feedback doc); the label-existence test above still covers it.
      sampledAnyLabel = true;

      const allowed = new Set([node.key_property.name, ...node.properties.map((p) => p.name)]);
      if (node.metadata?.baseLabel === 'Node') for (const key of baseKeys) allowed.add(key);

      for (const record of records) {
        for (const key of record.get('keys') as string[]) {
          expect(allowed.has(key), `${node.label}.${key} was written by refresh but is not declared in graph-model.json`).toBe(true);
        }
      }
    }
    expect(sampledAnyLabel).toBe(true);
  });
});
