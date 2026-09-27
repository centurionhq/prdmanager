#!/usr/bin/env node
/**
 * WO-586 / SDD-057: polls `GET /api/health` with linear backoff after a deploy, mirroring the exact
 * liveness check `packages/server/Dockerfile`'s own `HEALTHCHECK` already runs (same `PRDM_SERVER_PORT`
 * default of `4601`). Used by the RSI loop (`scripts/rsi/driver.mjs`) to decide success vs. rollback.
 *
 * `/api/health` (`packages/server/src/api/health.ts`) has no DB/mailer/LLM dependency by design -- this
 * only confirms the process is up and serving, not that the app is fully functional end to end.
 */
import process from 'node:process';
import { isEntryPoint } from '../../../scripts/entry-point.mjs';

const DEFAULT_PORT = '4601';
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_DELAY_MS = 1000;

/**
 * @param {{ port?: string, attempts?: number, delayMs?: number, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<{ ok: boolean, attempts: number, lastError?: string }>}
 */
export async function smokeCheck(options = {}) {
  const port = options.port ?? process.env.PRDM_SERVER_PORT ?? DEFAULT_PORT;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return { ok: true, attempts: attempt };
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await sleep(delayMs * attempt);
  }
  return { ok: false, attempts, lastError };
}

if (isEntryPoint(import.meta.url)) {
  const result = await smokeCheck();
  if (!result.ok) console.error(`smoke-check failed after ${result.attempts} attempt(s): ${result.lastError}`);
  process.exitCode = result.ok ? 0 : 1;
}
