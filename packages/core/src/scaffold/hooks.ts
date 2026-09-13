import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { detectPrdmBin } from './detect-bin.js';
import { shellQuoteSingle } from './shell-quote.js';

const run = promisify(execFile);

export type HookKind = 'post-commit' | 'commit-msg';
export const HOOK_KINDS: readonly HookKind[] = ['post-commit', 'commit-msg'];
export const HOOK_MODE = 0o755;

/** The exact PRD-001 `post-commit` body this repository's earlier `prdm sync` hook installer used to write. */
const LEGACY_POST_COMMIT_LINE = 'npm run --silent prdm -- sync || true';

const MARKER_END = '# <<< prdm <<<';
const markerStart = (projectId: string): string => `# >>> prdm ${projectId} >>>`;
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `git rev-parse --git-path hooks`, resolved to an absolute path: honors `core.hooksPath`, worktrees and husky. */
export async function resolveHooksDir(root: string): Promise<string> {
  const { stdout } = await run('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' });
  const dir = stdout.trim();
  return isAbsolute(dir) ? dir : resolve(root, dir);
}

/** `git rev-parse --show-toplevel`, for computing the project's *relative* position within the repository once, at install time (WO-024 finding 4). */
export async function resolveToplevel(root: string): Promise<string> {
  const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  return stdout.trim();
}

/** Posix-relative path from the repo top-level down to the project root, `.` when they coincide. Captured once at
 * install time: hooks are shared across every linked worktree of the same repository (WO-024 finding 4), and this
 * relative layout is assumed stable across all of them, while the top-level itself is recomputed at run time. */
export function relativeProjectPath(toplevel: string, rootAbs: string): string {
  const rel = relative(toplevel, rootAbs).split('\\').join('/');
  return rel === '' ? '.' : rel;
}

/**
 * The `prdm_run` shell function shared by both hooks: dispatches to `$PRDM_BIN` (via `eval`, for multi-word
 * overrides) or the detected default (already safely quoted, inlined verbatim).
 *
 * Before doing anything else it absolutizes `GIT_DIR`/`GIT_INDEX_FILE` against the invocation `$PWD` (WO-024
 * finding 4): git sets these as paths relative to the directory the git command was originally run from, and once
 * this hook `cd`s elsewhere below, any further git invocation (including `git rev-parse --show-toplevel` itself,
 * and anything `prdm sync`/`prdm check` runs) would otherwise resolve them against the *new* cwd and silently miss
 * the real repository/index.
 */
function prdmRunFunction(detected: string): string {
  return [
    'prdm_run() {',
    '  if [ -n "$PRDM_BIN" ]; then',
    '    eval "$PRDM_BIN \\"\\$@\\""',
    '  else',
    `    ${detected} "$@"`,
    '  fi',
    '}',
  ].join('\n');
}

/** Absolutizes `$GIT_DIR`/`$GIT_INDEX_FILE` (when set and relative) against `$PWD`, before any `cd` (WO-024 finding 4). */
const ABSOLUTIZE_GIT_ENV = [
  'case "$GIT_DIR" in',
  '  ""|/*) : ;;',
  '  *) GIT_DIR="$PWD/$GIT_DIR"; export GIT_DIR ;;',
  'esac',
  'case "$GIT_INDEX_FILE" in',
  '  ""|/*) : ;;',
  '  *) GIT_INDEX_FILE="$PWD/$GIT_INDEX_FILE"; export GIT_INDEX_FILE ;;',
  'esac',
].join('\n');

/** `cd "$(git rev-parse --show-toplevel)"[/'<relProject>']`, computed at run time (WO-024 finding 4): the
 * top-level is re-resolved on every invocation (correct for whichever worktree the commit actually happened in),
 * while `relProject` (captured once at install time) is quoted verbatim and appended only when the project is not
 * itself the top-level. */
function cdToProjectRoot(relProject: string): string {
  const suffix = relProject === '.' ? '' : `/${shellQuoteSingle(relProject)}`;
  return `prdm_toplevel="$(git rev-parse --show-toplevel)" && cd "$prdm_toplevel"${suffix}`;
}

function postCommitBody(relProject: string, detected: string): string {
  return [
    prdmRunFunction(detected),
    ABSOLUTIZE_GIT_ENV,
    `[ "$PRDM_SKIP_HOOKS" = 1 ] || (${cdToProjectRoot(relProject)} && prdm_run sync) >/dev/null 2>&1 || true`,
  ].join('\n');
}

/** `$1` (the commit message file) is absolutized before `cd`, since it is normally relative to the pre-hook cwd. */
function commitMsgBody(relProject: string, detected: string): string {
  return [
    prdmRunFunction(detected),
    ABSOLUTIZE_GIT_ENV,
    'prdm_msgfile=$1',
    'case "$prdm_msgfile" in',
    '  /*) : ;;',
    '  *) prdm_msgfile="$PWD/$prdm_msgfile" ;;',
    'esac',
    `[ "$PRDM_SKIP_HOOKS" = 1 ] || (${cdToProjectRoot(relProject)} && prdm_run check commit-msg "$prdm_msgfile")`,
  ].join('\n');
}

export function blockBodyFor(kind: HookKind, relProject: string, detected: string): string {
  return kind === 'post-commit' ? postCommitBody(relProject, detected) : commitMsgBody(relProject, detected);
}

function parseShebang(content: string): { shebang: string | null; rest: string } {
  const newline = content.indexOf('\n');
  const firstLine = newline === -1 ? content : content.slice(0, newline);
  if (!firstLine.startsWith('#!')) return { shebang: null, rest: content };
  return { shebang: firstLine, rest: newline === -1 ? '' : content.slice(newline + 1) };
}

function isShCompatible(shebang: string | null): boolean {
  return shebang === null || /^#!\s*\S*\b(sh|bash)\s*$/.test(shebang);
}

/**
 * Replaces this project's existing block in place, or appends a new one after any other content. Uses a replacer
 * *function* rather than passing `newBlock` as a plain string (WO-024 finding 4): `String.replace`'s string form
 * treats `$&`, `` $` ``, `$'`, `$$`, `$<n>` in the replacement specially, which would silently corrupt the output
 * were the project's root/relative path (embedded in `newBlock`) to ever contain one of those sequences.
 */
function upsertBlock(rest: string, projectId: string, newBlock: string): string {
  const re = new RegExp(`${escapeRegExp(markerStart(projectId))}[\\s\\S]*?${escapeRegExp(MARKER_END)}`);
  if (re.test(rest)) return rest.replace(re, () => newBlock);
  const trimmed = rest.replace(/\s+$/, '');
  return trimmed.length > 0 ? `${trimmed}\n\n${newBlock}\n` : `${newBlock}\n`;
}

export interface HookPlan {
  content: string;
  changed: boolean;
}

/**
 * Computes the new content of one hook file (idempotent: `changed` is `false` once the block already matches).
 * A legacy PRD-001 `post-commit` body (and only that exact body) is replaced outright by the marker block instead
 * of having the block appended after it. Any other pre-existing content is preserved, with the block appended.
 */
export function planHookFile(kind: HookKind, existing: string | null, projectId: string, relProject: string, detected: string, force = false): HookPlan {
  const newBlock = `${markerStart(projectId)}\n${blockBodyFor(kind, relProject, detected)}\n${MARKER_END}`;
  if (existing === null) return { content: `#!/bin/sh\n${newBlock}\n`, changed: true };

  const { shebang, rest } = parseShebang(existing);
  if (!isShCompatible(shebang) && !force) {
    throw new Error(`refusing to modify ${kind}: unrecognized shebang "${shebang}" (use --force to append the prdm block anyway)`);
  }
  const isLegacy = kind === 'post-commit' && rest.trim() === LEGACY_POST_COMMIT_LINE;
  const content = `${shebang ?? '#!/bin/sh'}\n${upsertBlock(isLegacy ? '' : rest, projectId, newBlock)}`;
  return { content, changed: content !== existing };
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export interface InstallHooksResult {
  installed: string[];
  unchanged: string[];
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await fs.lstat(path)).isSymbolicLink();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Installs (or refreshes) the `post-commit` and `commit-msg` hooks for `projectId` at `root`. `root` is the prdm
 * project root, used at install time to locate `package.json`/`node_modules/.bin` for detection and to compute its
 * position relative to the git top-level (WO-024 finding 4): the hook itself re-resolves the top-level at *run*
 * time and `cd`s to `<toplevel>/<relative project path>`, so a hook shared across linked worktrees (hooks live in
 * the common git dir, not per-worktree) always lands in the worktree the commit is actually happening in, never
 * back in the checkout it was installed from. The hooks themselves are written wherever `git rev-parse --git-path
 * hooks` points, which may be outside `root` entirely (`core.hooksPath`), so this never goes through `safe-fs`.
 */
export async function installHooks(root: string, projectId: string, options: { force?: boolean } = {}): Promise<InstallHooksResult> {
  const hooksDir = await resolveHooksDir(root);
  const detected = await detectPrdmBin(root);
  const rootAbs = resolve(root);
  const toplevel = await resolveToplevel(root);
  const relProject = relativeProjectPath(toplevel, rootAbs);
  const result: InstallHooksResult = { installed: [], unchanged: [] };

  for (const kind of HOOK_KINDS) {
    const path = join(hooksDir, kind);
    // Refuse to write through a symlink (WO-024 finding 4): an attacker-planted symlink at a hook path could
    // otherwise redirect the write to an arbitrary file outside the hooks directory.
    if (await isSymlink(path)) throw new Error(`refusing to write through symlinked hook file: ${path}`);
    const existing = await readIfExists(path);
    const plan = planHookFile(kind, existing, projectId, relProject, detected, options.force);
    if (!plan.changed) {
      result.unchanged.push(path);
      continue;
    }
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, plan.content, 'utf8');
    await fs.chmod(path, HOOK_MODE);
    result.installed.push(path);
  }
  return result;
}
