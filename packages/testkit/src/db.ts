import { resolve } from 'node:path';
import { loadConfig, Neo4jGraphStore, type PrdmConfig } from '@prdm/core';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');

export function testConfig(root: string): PrdmConfig {
  const project = loadConfig(PROJECT_ROOT);
  const uri = process.env.NEO4J_TEST_URI ?? 'neo4j://127.0.0.1:7688';
  if (uri === project.neo4j.uri) throw new Error('refusing to run destructive tests against the development Neo4j instance');
  return loadConfig(root, { NEO4J_PASSWORD: project.neo4j.password, NEO4J_URI: uri, NEO4J_USERNAME: project.neo4j.username });
}

export async function openTestStore(config: PrdmConfig): Promise<Neo4jGraphStore> {
  const store = Neo4jGraphStore.connect(config.neo4j);
  try {
    await store.verify();
  } catch (err) {
    await store.close();
    throw new Error(`Neo4j test instance unreachable at ${config.neo4j.uri}; run "docker compose --profile test up -d neo4j-test" (${(err as Error).message})`);
  }
  await store.clear();
  await store.migrate();
  return store;
}
