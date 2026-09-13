import type { FastifyInstance, InjectOptions } from 'fastify';
import { Engine, type GraphDatabase, type GraphStore, type PrdmConfig } from '@prdm/core';
import { createFixtureRepo, openTestDb, removeDir, testConfig } from '@prdm/testkit';
import { buildApp, DEFAULT_WEB_PORT, type BuildAppOptions } from '../../src/app.js';

/** The only `Host` header the DNS-rebinding guard accepts at `DEFAULT_WEB_PORT` (SDD-005 "Seguridad"). */
export const TEST_HOST_HEADER = `127.0.0.1:${DEFAULT_WEB_PORT}`;

export interface WebTestContext {
  root: string;
  config: PrdmConfig;
  db: GraphDatabase;
  store: GraphStore;
  engine: Engine;
  app: FastifyInstance;
}

/**
 * Fixture repo + real Neo4j test instance + a fully wired `buildApp`, mirroring `packages/mcp/tests/integration`'s
 * setup but with `app.inject()` in place of an MCP client. Seeds the store with one `engine.refresh()` (same as
 * every MCP integration suite) so routes have real data to read; `buildApp` itself never calls `refresh`/`recover`.
 */
export async function setupWebTest(buildOverrides: Partial<BuildAppOptions> = {}): Promise<WebTestContext> {
  const root = createFixtureRepo();
  const config = testConfig(root);
  const { db, store } = await openTestDb(config);
  const engine = new Engine(config, store);
  await engine.refresh();
  const app = buildApp({ config, store, engine, ...buildOverrides });
  await app.ready();
  return { root, config, db, store, engine, app };
}

export async function teardownWebTest(ctx: WebTestContext): Promise<void> {
  await ctx.app.close();
  await ctx.db.close();
  removeDir(ctx.root);
}

/** `app.inject()` with the `Host` header the DNS-rebinding guard requires already set (SDD-005 "Seguridad"). */
export function injectApi(app: FastifyInstance, options: InjectOptions | string) {
  const base = typeof options === 'string' ? { method: 'GET' as const, url: options } : options;
  return app.inject({ ...base, headers: { host: TEST_HOST_HEADER, ...base.headers } });
}
