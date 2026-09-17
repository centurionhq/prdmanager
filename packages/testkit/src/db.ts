import { resolve } from 'node:path';
import { loadConfig, loadNeo4jConfig, Neo4jGraphDatabase, type GraphStore, type PrdmConfig } from '@prdm/core';
import { assertDbAllowed } from './guard.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');

export function testConfig(root: string): PrdmConfig {
  // `loadNeo4jConfig` alone (not the full `loadConfig`): this repository's own `.prdm.yaml` may be a
  // `version: 2` (remote) project (SDD-010 "Modo remoto") once it migrates its own governance
  // server-side — that says nothing about the *local dev* Neo4j these integration tests must never
  // collide with, which lives purely in `NEO4J_*`/`.env`, independent of `.prdm.yaml`'s version.
  const devNeo4j = loadNeo4jConfig(PROJECT_ROOT, process.env);
  const uri = process.env.NEO4J_TEST_URI ?? 'neo4j://127.0.0.1:7688';
  if (uri === devNeo4j.uri) throw new Error('refusing to run destructive tests against the development Neo4j instance');
  return loadConfig(root, { NEO4J_PASSWORD: devNeo4j.password, NEO4J_URI: uri, NEO4J_USERNAME: devNeo4j.username });
}

export interface TestDb {
  db: Neo4jGraphDatabase;
  store: GraphStore;
}

/**
 * Connects to the shared test Neo4j instance, applies every pending migration (idempotent, safe to call from
 * every test file since `fileParallelism: false` runs them one at a time) and returns a store scoped to
 * `config.project`, cleared of any leftovers from a previous run of the same fixture.
 */
export async function openTestDb(config: PrdmConfig): Promise<TestDb> {
  assertDbAllowed();
  const db = Neo4jGraphDatabase.connect(config.neo4j);
  try {
    await db.verify();
  } catch (err) {
    await db.close();
    throw new Error(`Neo4j test instance unreachable at ${config.neo4j.uri}; run "docker compose --profile test up -d neo4j-test" (${(err as Error).message})`);
  }
  await db.migrate();
  const store = db.forProject(config.project);
  await store.clear();
  return { db, store };
}
