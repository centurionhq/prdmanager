import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { shellQuoteSingle } from './shell-quote.js';

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function npmScriptCommand(root: string): Promise<string | null> {
  const pkgPath = join(root, 'package.json');
  if (!(await pathExists(pkgPath))) return null;
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as { scripts?: Record<string, unknown> };
    return typeof pkg.scripts?.prdm === 'string' ? 'npm run --silent prdm --' : null;
  } catch {
    return null;
  }
}

/**
 * Detects, at `prdm init`/`hooks install` time, the literal shell command a hook should run to invoke `prdm`
 * (overridable at runtime via `PRDM_BIN`). Preference order: an npm script named `prdm` at the project root (this
 * monorepo's own case), then the workspace-linked binary in `node_modules/.bin`, then a bare `npx` fallback.
 * The result is inlined once into the generated hook script, so any path is quoted here and only here.
 */
export async function detectPrdmBin(root: string): Promise<string> {
  const npmScript = await npmScriptCommand(root);
  if (npmScript) return npmScript;

  const binPath = join(root, 'node_modules', '.bin', 'prdm');
  if (await pathExists(binPath)) return shellQuoteSingle(binPath);

  return 'npx --no-install prdm';
}
