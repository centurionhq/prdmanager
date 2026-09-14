#!/usr/bin/env node
// SDD-006: bootstrap for the SaaS server. The only module in this package allowed to read `process.env`
// or call `.listen()` — everything else takes its dependencies injected (see build-server.ts).
import process from 'node:process';
import { createPool, reconcileSuperadminMemberships } from '@prdm/db';
import { buildServer } from './build-server.js';
import { DEFAULT_SERVER_HOST, resolveServerEnv } from './env.js';
import { NodemailerMailer } from './nodemailer-mailer.js';

async function main(): Promise<void> {
  const env = resolveServerEnv(process.env);
  const pool = createPool({ connectionString: env.databaseUrl });
  const mailer = new NodemailerMailer(env.smtp);
  const app = buildServer({ env, pool, mailer });

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
