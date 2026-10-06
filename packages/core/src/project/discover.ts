import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { glob } from 'tinyglobby';

const PROJECT_FILE = '.prdm.yaml';
const LEGACY_CONFIG_FILE = 'prdm.config.json';

function hasProjectMarker(dir: string): boolean {
  return existsSync(join(dir, PROJECT_FILE)) || existsSync(join(dir, LEGACY_CONFIG_FILE));
}

function assertForcedRoot(root: string): string {
  if (hasProjectMarker(root)) return root;
  throw new Error(`PRDM_ROOT=${root} does not contain ${PROJECT_FILE} or ${LEGACY_CONFIG_FILE}`);
}

/**
 * Finds the active project root (SDD-002 "Proyecto activo"):
 * `PRDM_ROOT` forces the root (must contain `.prdm.yaml` or the legacy `prdm.config.json`); otherwise walks up from
 * `startDir` looking for `.prdm.yaml`, stopping at the first one found. If none exists anywhere up to the filesystem
 * root, falls back to the nearest ancestor with a legacy `prdm.config.json`, and finally to `startDir` itself so
 * repositories without either file keep working exactly as before WO-017.
 */
export function discoverProjectRoot(startDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const forced = env.PRDM_ROOT;
  if (forced) return assertForcedRoot(resolve(forced));

  let current = resolve(startDir);
  let legacyMatch: string | null = null;
  for (;;) {
    if (existsSync(join(current, PROJECT_FILE))) return current;
    if (legacyMatch === null && existsSync(join(current, LEGACY_CONFIG_FILE))) legacyMatch = current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return legacyMatch ?? resolve(startDir);
}

/**
 * Root-relative posix paths (no trailing slash) of every subdirectory below `root` that owns its own `.prdm.yaml`;
 * each one is a nested project and must be excluded from `root`'s scan, governed-code resolution and commit policy
 * (SDD-002 "Proyecto activo"). `root`'s own `.prdm.yaml`, if any, is never included.
 */
export async function findNestedProjectRoots(root: string, ignore: string[]): Promise<string[]> {
  const matches = await glob(`**/${PROJECT_FILE}`, {
    cwd: root,
    ignore,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    expandDirectories: false,
  });
  const suffix = `/${PROJECT_FILE}`;
  return matches
    .filter((rel) => rel !== PROJECT_FILE)
    .map((rel) => rel.slice(0, -suffix.length))
    .sort();
}
