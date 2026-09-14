#!/usr/bin/env node
// SDD-006: bootstrap for the SaaS server. The only module in this package allowed to read `process.env`
// or call `.listen()` — everything else takes its dependencies injected (see build-server.ts).
import process from 'node:process';
import { buildServer } from './build-server.js';
import { DEFAULT_SERVER_HOST, resolveServerEnv } from './env.js';

async function main(): Promise<void> {
  const env = resolveServerEnv(process.env);
  const app = buildServer({ env });

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ host: DEFAULT_SERVER_HOST, port: env.serverPort });
}

main().catch((err: unknown) => {
  console.error('[prdm-server] fatal error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
