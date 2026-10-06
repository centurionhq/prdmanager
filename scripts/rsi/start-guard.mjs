/**
 * WO-610 / SDD-063: guarda de partida reproducible. Antes de que el driver RSI o el deploy construyan y
 * reinicien el servicio, el checkout tiene que ser un punto de partida reproducible: árbol limpio, en la
 * rama de integración y sin commits sin pushear. Siempre evalúa los 3 checks y lista la evidencia exacta;
 * `PRDM_ALLOW_DIRTY_START=1` es un escape hatch que degrada los problemas a warnings (nunca silencioso).
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

export const DEFAULT_INTEGRATION_BRANCH = 'main';
export const INTEGRATION_BRANCH_ENV = 'PRDM_INTEGRATION_BRANCH';
export const ALLOW_DIRTY_START_ENV = 'PRDM_ALLOW_DIRTY_START';

function defaultRunGit(args, { cwd }) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr || (result.error ? String(result.error.message) : ''),
  };
}

/**
 * @param {object} [options]
 * @returns {import('./start-guard.d.mts').StartGuardResult}
 */
export function checkRepoStart(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const expectedBranch = options.integrationBranch ?? (env[INTEGRATION_BRANCH_ENV] || DEFAULT_INTEGRATION_BRANCH);
  const allowDirtyStart = options.allowDirtyStart ?? env[ALLOW_DIRTY_START_ENV] === '1';
  const runGit = options.runGit ?? defaultRunGit;

  let problems = [];
  let dirtyFiles = [];
  let currentBranch = null;
  let unpushedCount = null;
  let hasUpstream = false;

  const statusRes = runGit(['status', '--porcelain'], { cwd });
  if (statusRes.status !== 0) {
    problems.push(`could not read the working tree state (\`git status --porcelain\` failed): ${statusRes.stderr.trim()}`);
  } else if (statusRes.stdout.trim() !== '') {
    dirtyFiles = statusRes.stdout.split('\n').filter((line) => line.trim() !== '');
    problems.push(`working tree is not clean (${dirtyFiles.length} path(s)): ${dirtyFiles.join(' | ')}`);
  }

  const branchRes = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (branchRes.status !== 0) {
    problems.push(`could not determine the current branch (\`git rev-parse --abbrev-ref HEAD\` failed): ${branchRes.stderr.trim()}`);
  } else {
    currentBranch = branchRes.stdout.trim();
    if (currentBranch !== expectedBranch) {
      problems.push(`HEAD is on branch "${currentBranch}" but the expected integration branch is "${expectedBranch}"`);
    }
  }

  const unpushedRes = runGit(['rev-list', '--count', '@{u}..HEAD'], { cwd });
  if (unpushedRes.status !== 0) {
    problems.push(
      `branch "${currentBranch}" has no upstream configured (set one with \`git push -u <remote> <branch>\`): ${unpushedRes.stderr.trim()}`,
    );
  } else {
    hasUpstream = true;
    unpushedCount = Number.parseInt(unpushedRes.stdout.trim(), 10);
    if (unpushedCount > 0) {
      problems.push(`${unpushedCount} commit(s) not pushed to the upstream of "${currentBranch}"`);
    }
  }

  let warnings = [];
  let ok = problems.length === 0;
  if (allowDirtyStart) {
    warnings = problems.map((p) => `${ALLOW_DIRTY_START_ENV}=1 is ignoring: ${p}`);
    problems = [];
    ok = true;
  }

  return { ok, expectedBranch, currentBranch, dirtyFiles, unpushedCount, hasUpstream, problems, warnings };
}

/** @param {import('./start-guard.d.mts').StartGuardResult} result */
export function reportStartGuard(result, log = console) {
  for (const warning of result.warnings) log.warn(`rsi-start-guard: ${warning}`);
  if (!result.ok) {
    log.error('rsi-start-guard: refusing to start -- the checkout is not a reproducible starting point:');
    for (const problem of result.problems) log.error(`  - ${problem}`);
  }
}

export function enforceStartGuard(options = {}) {
  const result = checkRepoStart(options);
  reportStartGuard(result, options.log ?? console);
  return result;
}
