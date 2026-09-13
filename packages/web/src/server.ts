#!/usr/bin/env node
// PRD-004 / SDD-005: bootstrap for the read-only web explorer.
import process from 'node:process';
import { discoverProjectRoot, Engine, loadConfig, Neo4jGraphDatabase } from '@prdm/core';
import { buildApp } from './app.js';
import { resolveWebBind } from './env.js';

async function main(): Promise<void> {
  const bind = resolveWebBind(process.env);
  const root = discoverProjectRoot(process.cwd(), process.env);
  const config = loadConfig(root);
  const db = Neo4jGraphDatabase.connect(config.neo4j);
  await db.verify();
  // Same refusal as packages/mcp/src/server.ts: never silently migrate an unknown/outdated schema at boot.
  await db.assertSchemaCurrent();
  const store = db.forProject(config.project);
  // SDD-005 "Ciclo de vida del Engine": unlike packages/mcp/src/server.ts, this Engine never calls refresh()/recover()
  // — this process only ever reads whatever Neo4j snapshot (and, for /api/drift, disk state) already exists.
  const engine = new Engine(config, store);

  const app = buildApp({ config, store, engine, port: bind.port });
  app.addHook('onClose', async () => {
    await db.close();
  });

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ host: bind.host, port: bind.port });
}

main().catch((err: unknown) => {
  console.error('[prdm-web] fatal error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
