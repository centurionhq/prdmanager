import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { Engine, parseProjectFile, renderProjectFile, scanDocuments } from '@prdm/core';
import { createFixtureRepo, openTestDb, testConfig } from '@prdm/testkit';

/**
 * SDD-005 "Tests": local-only E2E (not part of the CI gate, see SDD-005's own note on why). Seeds a real fixture
 * repo into the shared Neo4j test instance (same `createFixtureRepo`/`testConfig`/`openTestDb` used by every
 * backend integration test) with one `engine.refresh()` — writing a clean baseline — then points the *built*
 * server (`node dist/server/server.js`, cwd = the fixture root) at it. Top-level await is fine here: Playwright
 * loads an ESM config as a module.
 */
const PORT = 4610;
const root = createFixtureRepo({ withProjectFile: true });

// The shared fixture predates PRD-002's lifecycle rules (MRD-001 has no justified_by, WO-001 no source_task).
// Every MCP integration test grandfathers them via an in-memory PrdmConfig override, but that trick doesn't
// reach here: this E2E's server runs in its *own OS process* (spawned below), which loads its own config fresh
// from disk — an in-memory override on this script's `config` object would only affect this script's seeding
// Engine, never what the running server's own /api/drift actually reports. Persisting it into the fixture's own
// .prdm.yaml is what makes both sides agree.
const preScan = await scanDocuments(root, testConfig(root).ignore);
const grandfathered = preScan.docs.filter((d) => d.node.id === 'MRD-001' || d.node.id === 'WO-001').map((d) => ({ id: d.node.id, hash: d.node.contentHash }));
const projectFilePath = join(root, '.prdm.yaml');
const projectFile = parseProjectFile(readFileSync(projectFilePath, 'utf8'));
writeFileSync(projectFilePath, renderProjectFile({ ...projectFile, lifecycle: { grandfathered } }));

const config = testConfig(root);
const { db, store } = await openTestDb(config);
const engine = new Engine(config, store);
await engine.refresh();
await db.close();

const SERVER_ENTRY = fileURLToPath(new URL('./dist/server/server.js', import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: `node ${SERVER_ENTRY}`,
    cwd: root,
    env: {
      // Cleared: this config file itself needs `NODE_OPTIONS=--conditions=@prdm/source` to resolve
      // `@prdm/testkit`/`@prdm/core` from their TypeScript sources (source-only, no built dist — same reason
      // root scripts like `mcp`/`prdm` run through `tsx --conditions=@prdm/source`), but that condition would
      // make plain `node` here try to resolve @prdm/core to its own .ts sources too, which it can't load.
      NODE_OPTIONS: '',
      PRDM_WEB_PORT: String(PORT),
      NEO4J_URI: config.neo4j.uri,
      NEO4J_USERNAME: config.neo4j.username,
      NEO4J_PASSWORD: config.neo4j.password,
      NEO4J_DATABASE: config.neo4j.database,
    },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
