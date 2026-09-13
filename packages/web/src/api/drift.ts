import type { FastifyInstance } from 'fastify';
import type { Engine, RefreshReport } from '@prdm/core';

export interface DriftRouteDeps {
  engine: Engine;
}

/** `engine.inspect()`'s own cost budget (SDD-005 "Ciclo de vida del Engine": re-scans the repo, re-hashes symbols, reads up to 500 commits). */
const CACHE_TTL_MS = 2000;

interface DriftCache {
  result: RefreshReport;
  expiresAt: number;
}

/**
 * `GET /api/drift` (SDD-005 "Contrato HTTP"): calls `engine.inspect()` only — never `refresh()`/`recover()`, so
 * this never writes `.prdm/baseline.json`, never touches `.prdm/symbol-cache.json` and never calls
 * `store.writeSnapshot`. A single in-flight promise is shared by concurrent callers (double-clicking "Actualizar",
 * two tabs) and the last result is kept for a short TTL — not a real cache, just enough to collapse a burst of
 * requests into one `inspect()` (SDD-005 "Ciclo de vida del Engine").
 */
export function registerDriftRoute(app: FastifyInstance, deps: DriftRouteDeps): void {
  let inFlight: Promise<RefreshReport> | null = null;
  let cache: DriftCache | null = null;

  async function getDrift(): Promise<RefreshReport> {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.result;
    if (inFlight) return inFlight;

    inFlight = deps.engine.inspect().finally(() => {
      inFlight = null;
    });
    try {
      const result = await inFlight;
      cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
      return result;
    } catch (err) {
      cache = null;
      throw err;
    }
  }

  app.get('/api/drift', async () => getDrift());
}
