/**
 * PRD-008 §4.3 (WO-408): pure orchestration pieces for `scripts/hooks/pre-commit`, split out the same
 * way WO-409 split `pre-push` from `pre-push-lib.mjs` -- so `packages/server/tests/unit/pre-commit-hook.
 * test.ts` can exercise the staged-file filtering logic directly, without spawning git or running
 * typecheck/vitest for real. `scripts/hooks/pre-commit` itself stays a thin script that wires these pure
 * functions to real `spawnSync` calls.
 */

/** Staged file extensions that can affect typecheck/test outcomes; nothing else can move the hook past
 * its first gate (WO-408 requirement 1). `vitest.config.ts` is already covered by the `.ts` suffix
 * below, but gets its own explicit check so the intent -- a test-config change must always trigger a run
 * -- stays visible in the code instead of resting on a suffix coincidence. */
const RELEVANT_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.json'];

/** @param {string} path */
export function isRelevantPath(path) {
  if (RELEVANT_EXTENSIONS.some((ext) => path.endsWith(ext))) return true;
  return path === 'vitest.config.ts' || path.endsWith('/vitest.config.ts');
}

/** @param {string[]} paths */
export function filterRelevantFiles(paths) {
  return paths.filter(isRelevantPath);
}

/**
 * Parses `git diff --cached --name-only --diff-filter=ACM`'s stdout (one path per line) into a clean
 * array. An empty diff prints an empty string (or a lone blank line, depending on git version), both of
 * which must parse to `[]` rather than `['']`.
 *
 * @param {string} rawOutput
 */
export function parseStagedFiles(rawOutput) {
  return rawOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Parses `lib-detect-db-related.mjs`'s stdout (expected to be a single non-negative integer) into a
 * count, or `null` if it printed something else -- the caller must treat `null` as a detection failure
 * (abort), never as "0 related tests" (see that script's own header comment for why).
 *
 * @param {string} rawOutput
 * @returns {number | null}
 */
export function parseDbRelatedCount(rawOutput) {
  const trimmed = rawOutput.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}
