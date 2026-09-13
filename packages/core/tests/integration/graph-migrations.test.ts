import neo4j, { type Driver } from 'neo4j-driver';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { Neo4jGraphDatabase } from '../../src/graph/database.js';
import { MIGRATIONS, checksumOf } from '../../src/graph/migrations.js';
import { testConfig } from '@prdm/testkit';

const config = testConfig(process.cwd());
let rawDriver: Driver;

const ALL_KNOWN_CONSTRAINTS = [
  'node_id',
  'coderef_key',
  'commit_sha',
  'actor_id',
  'schema_migration_version',
  'project_id',
  'node_project_id',
  'coderef_project_key',
  'commit_project_sha',
  'actor_project_id',
];
const ALL_KNOWN_INDEXES = [
  'node_status',
  'node_kind',
  'node_text',
  'node_text_v2',
  'node_project_id_idx',
  'coderef_project_id_idx',
  'commit_project_id_idx',
  'actor_project_id_idx',
  'node_project_status',
];

async function wipeSchemaAndData(): Promise<void> {
  for (const name of ALL_KNOWN_CONSTRAINTS) await rawDriver.executeQuery(`DROP CONSTRAINT ${name} IF EXISTS`, {}, { database: config.neo4j.database });
  for (const name of ALL_KNOWN_INDEXES) await rawDriver.executeQuery(`DROP INDEX ${name} IF EXISTS`, {}, { database: config.neo4j.database });
  // `CALL ... IN TRANSACTIONS` needs a true auto-commit query (session.run), not driver.executeQuery's managed transaction.
  const session = rawDriver.session({ database: config.neo4j.database });
  try {
    await session.run('MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 1000 ROWS');
  } finally {
    await session.close();
  }
}

async function constraintNames(): Promise<string[]> {
  const { records } = await rawDriver.executeQuery('SHOW CONSTRAINTS YIELD name RETURN name', {}, { database: config.neo4j.database });
  return records.map((r) => r.get('name') as string);
}

async function indexNames(): Promise<string[]> {
  const { records } = await rawDriver.executeQuery('SHOW INDEXES YIELD name RETURN name', {}, { database: config.neo4j.database });
  return records.map((r) => r.get('name') as string);
}

beforeEach(async () => {
  rawDriver = neo4j.driver(config.neo4j.uri, neo4j.auth.basic(config.neo4j.username, config.neo4j.password), { disableLosslessIntegers: true });
  await wipeSchemaAndData();
});

afterAll(async () => {
  await wipeSchemaAndData();
  await rawDriver.close();
});

describe('graph schema migrations (ADR-002 D3)', () => {
  test('assertSchemaCurrent throws on a fresh, unmigrated database', async () => {
    const db = Neo4jGraphDatabase.connect(config.neo4j);
    try {
      await db.verify();
      await expect(db.assertSchemaCurrent()).rejects.toThrow(/expects version/);
      const status = await db.schemaStatus();
      expect(status).toMatchObject({ current: 0, expected: 2 });
    } finally {
      await db.close();
    }
  });

  test('migrate applies v1 then v2, deletes unscoped legacy nodes, and leaves the expected constraints/indexes', async () => {
    // Simulate a PRD-001-shaped graph: old v1 schema plus derived nodes with no project_id, the way the
    // single-project store used to write them.
    for (const statement of MIGRATIONS[0]!.statements) await rawDriver.executeQuery(statement, {}, { database: config.neo4j.database });
    await rawDriver.executeQuery(
      "CREATE (:Node:Feature {id: 'PRD-999', ref: 'PRD-999', title: 'legacy', status: 'draft', kind: 'PRD', body: '', tags: [], tags_text: ''})",
      {},
      { database: config.neo4j.database },
    );
    await rawDriver.executeQuery("CREATE (:CodeRef {key: 'legacy.ts'})", {}, { database: config.neo4j.database });
    await rawDriver.executeQuery("CREATE (:Commit {sha: 'deadbeefdeadbeef'})", {}, { database: config.neo4j.database });
    await rawDriver.executeQuery("CREATE (:Actor {id: 'agent:legacy'})", {}, { database: config.neo4j.database });

    const db = Neo4jGraphDatabase.connect(config.neo4j);
    try {
      const status = await db.migrate();
      expect(status.current).toBe(2);
      expect(status.pending).toEqual([]);

      const { records } = await rawDriver.executeQuery("MATCH (n {id: 'PRD-999'}) RETURN n", {}, { database: config.neo4j.database });
      expect(records).toEqual([]);
      for (const label of ['legacy.ts', 'deadbeefdeadbeef', 'agent:legacy']) {
        const rows = await rawDriver.executeQuery('MATCH (n) WHERE n.key = $label OR n.sha = $label OR n.id = $label RETURN n', { label }, { database: config.neo4j.database });
        expect(rows.records).toEqual([]);
      }

      const constraints = await constraintNames();
      expect(constraints).toEqual(expect.arrayContaining(['node_project_id', 'coderef_project_key', 'commit_project_sha', 'actor_project_id', 'project_id', 'schema_migration_version']));
      expect(constraints).not.toEqual(expect.arrayContaining(['node_id', 'coderef_key', 'commit_sha', 'actor_id']));

      const indexes = await indexNames();
      expect(indexes).toEqual(expect.arrayContaining(['node_text_v2', 'node_project_status']));
      expect(indexes).not.toEqual(expect.arrayContaining(['node_text', 'node_status', 'node_kind']));

      // Idempotent re-run: no error, same version.
      const second = await db.migrate();
      expect(second.current).toBe(2);
    } finally {
      await db.close();
    }
  });

  test('detects an already-applied v1 schema with no SchemaMigration bookkeeping and records it before running v2', async () => {
    for (const statement of MIGRATIONS[0]!.statements) await rawDriver.executeQuery(statement, {}, { database: config.neo4j.database });

    const db = Neo4jGraphDatabase.connect(config.neo4j);
    try {
      const before = await db.schemaStatus();
      expect(before).toMatchObject({ current: 1, expected: 2 });

      await db.migrate();
      const { records } = await rawDriver.executeQuery(
        'MATCH (m:SchemaMigration {version: 1}) RETURN m.checksum AS checksum',
        {},
        { database: config.neo4j.database },
      );
      expect(records[0]?.get('checksum')).toBe(checksumOf(MIGRATIONS[0]!.statements));
    } finally {
      await db.close();
    }
  });

  test('a stored checksum that no longer matches this build is a hard error', async () => {
    const db = Neo4jGraphDatabase.connect(config.neo4j);
    try {
      await db.migrate();
      await rawDriver.executeQuery(
        "MATCH (m:SchemaMigration {version: 2}) SET m.checksum = 'tampered'",
        {},
        { database: config.neo4j.database },
      );
      await expect(db.migrate()).rejects.toThrow(/different checksum/);
    } finally {
      await db.close();
    }
  });
});
