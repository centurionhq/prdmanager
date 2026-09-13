#!/usr/bin/env node
import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Engine, loadConfig, Neo4jGraphDatabase } from '@prdm/core';
import { createPrdmServer } from './create.js';

async function main(): Promise<void> {
  const root = process.env.PRDM_ROOT ?? process.cwd();
  const config = loadConfig(root);
  const db = Neo4jGraphDatabase.connect(config.neo4j);
  await db.verify();
  // ADR-002 D3: destructive migrations only run via explicit `prdm db migrate`; the server refuses to start
  // against an unknown or outdated schema instead of silently migrating (and possibly deleting data) at boot.
  await db.assertSchemaCurrent();
  const store = db.forProject(config.project);

  const engine = new Engine(config, store);
  const report = await engine.refresh();
  console.error(
    `[prdm-graph] indexed ${report.documents} document(s); ${report.issues.length} issue(s); blocking=${report.hasBlockingIssues}`,
  );

  const server = createPrdmServer({ config, store, engine });
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await server.close();
    await db.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  transport.onclose = () => void shutdown();

  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[prdm-graph] fatal error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
