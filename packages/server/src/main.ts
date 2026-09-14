#!/usr/bin/env node
// SDD-006: bootstrap for the SaaS server. The only module in this package allowed to read `process.env`
// or call `.listen()` — everything else takes its dependencies injected (see build-server.ts).
import process from 'node:process';
import { createPool } from '@prdm/db';
import { buildServer } from './build-server.js';
import { DEFAULT_SERVER_HOST, resolveServerEnv } from './env.js';
import type { Mailer } from './mailer.js';

// TODO(WO-096): replace with the real nodemailer SMTP transport (mailpit in dev, real SMTP in prod).
// A silent no-op keeps `main.ts` runnable meanwhile without pretending mail was actually delivered.
class UnconfiguredMailer implements Mailer {
  async sendMail(): Promise<void> {
    /* no-op until WO-096 wires the nodemailer transport */
  }
}

async function main(): Promise<void> {
  const env = resolveServerEnv(process.env);
  const pool = createPool({ connectionString: env.databaseUrl });
  const mailer = new UnconfiguredMailer();
  const app = buildServer({ env, pool, mailer });

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
