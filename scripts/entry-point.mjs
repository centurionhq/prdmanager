/**
 * WO-584..588 / SDD-057 review follow-up: the `import.meta.url === pathToFileURL(process.argv[1]).href`
 * check was copied verbatim into `deploy.mjs`, `rollback.mjs`, `smoke-check.mjs` and `scripts/rsi/
 * driver.mjs` -- pulled out once here instead. `packages/server/scripts/dev.mjs` predates this module and
 * keeps its own inline copy (out of scope for this change to touch).
 */
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** @param {string} moduleUrl - pass `import.meta.url` from the calling module */
export function isEntryPoint(moduleUrl) {
  const entry = process.argv[1];
  return typeof entry === 'string' && moduleUrl === pathToFileURL(entry).href;
}
