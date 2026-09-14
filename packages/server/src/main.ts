#!/usr/bin/env node
// SDD-006: bootstrap for the SaaS server. The only module in this package allowed to read `process.env`
// or call `.listen()` — everything else takes its dependencies injected (see build-server.ts).
import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { Neo4jGraphDatabase } from '@prdm/core';
import { createPool, reconcileSuperadminMemberships } from '@prdm/db';
import { buildServer } from './build-server.js';
import { createDeepSeekClient, createRedactingLogger } from './agent/deepseek-client.js';
import type { LlmClient } from './agent/llm-client.js';
import { DEFAULT_SERVER_HOST, resolveServerEnv } from './env.js';
import { buildLoggerOptions } from './logging.js';
import { NodemailerMailer } from './nodemailer-mailer.js';

// `dist/main.js` and `../../app/dist` are resolved relative to this compiled file's own location — never
// `process.cwd()` — so `npm run server` works from any directory (mirrors `packages/web/src/server.ts`).
const APP_DIST = new URL('../../app/dist', import.meta.url);

async function main(): Promise<void> {
  const env = resolveServerEnv(process.env);
  const pool = createPool({ connectionString: env.databaseUrl });
  const mailer = new NodemailerMailer(env.smtp);
  // SDD-007 "PgProjectEngine" (WO-137): connects lazily (the driver itself never opens a socket up
  // front) and applies the graph's own schema migrations, idempotent and safe on every boot exactly
  // like `packages/testkit`'s equivalent does for tests.
  const neo4j = Neo4jGraphDatabase.connect(env.neo4j);
  await neo4j.migrate();

  const staticDir = fileURLToPath(APP_DIST);
  if (!existsSync(staticDir)) {
    throw new Error(`app bundle not found at ${staticDir}; run "npm run build --workspace=@prdm/app" first`);
  }

  // SDD-009: the agent is only registered at all when a real DeepSeek key is configured (ADR-006 "no se
  // habilita por variable de entorno" refers to FakeLlmClient specifically — this is the one real
  // construction site for the production LlmClient, driven by the already-validated env, not a boolean
  // flag). A standalone pino instance (not the Fastify app's own — that doesn't exist until buildServer
  // returns) with the same redact paths as every other log line, plus createRedactingLogger's substring
  // scrub as defense in depth for the raw message text pino's path-based redact can't reach.
  const llmClient: LlmClient | undefined = env.deepseek
    ? createDeepSeekClient({
        apiKey: env.deepseek.apiKey,
        baseUrl: env.deepseek.baseUrl,
        model: env.deepseek.model,
        logger: createRedactingLogger(pino(buildLoggerOptions({ level: 'warn', name: 'deepseek-client' })), env.deepseek.apiKey),
      })
    : undefined;

  const app = buildServer({ env, pool, mailer, staticDir, neo4j, llmClient });

  // Security review #1 (WO-101): the superadmin-org-creation flow can't be one DB transaction (better-auth's
  // internal writes aren't composable), so a crash mid-flow can leave a superadmin holding a stray `member`
  // row. Idempotent and cheap — safe to run on every boot.
  const reconciled = await reconcileSuperadminMemberships(pool);
  if (reconciled > 0) app.log.warn({ reconciled }, '[prdm-server] removed stray superadmin organization memberships at startup');

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await app.close();
    await neo4j.close();
    await pool.end();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ host: DEFAULT_SERVER_HOST, port: env.serverPort });
}

main().catch((err: unknown) => {
  console.error('[prdm-server] fatal error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
