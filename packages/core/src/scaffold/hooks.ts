import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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

/** The `prdm_run` shell function shared by both hooks: dispatches to `$PRDM_BIN` (via `eval`, for multi-word overrides) or the detected default (already safely quoted, inlined verbatim). */
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

function postCommitBody(rootAbs: string, detected: string): string {
  const cd = shellQuoteSingle(rootAbs);
  return [prdmRunFunction(detected), `[ "$PRDM_SKIP_HOOKS" = 1 ] || (cd ${cd} && prdm_run sync) >/dev/null 2>&1 || true`].join('\n');
}

/** `$1` (the commit message file) is absolutized before `cd`, since it is normally relative to the pre-hook cwd. */
function commitMsgBody(rootAbs: string, detected: string): string {
  const cd = shellQuoteSingle(rootAbs);
  return [
    prdmRunFunction(detected),
    'prdm_msgfile=$1',
    'case "$prdm_msgfile" in',
    '  /*) : ;;',
    '  *) prdm_msgfile="$PWD/$prdm_msgfile" ;;',
    'esac',
    `[ "$PRDM_SKIP_HOOKS" = 1 ] || (cd ${cd} && prdm_run check commit-msg "$prdm_msgfile")`,
  ].join('\n');
}

export function blockBodyFor(kind: HookKind, rootAbs: string, detected: string): string {
  return kind === 'post-commit' ? postCommitBody(rootAbs, detected) : commitMsgBody(rootAbs, detected);
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

/** Replaces this project's existing block in place, or appends a new one after any other content. */
function upsertBlock(rest: string, projectId: string, newBlock: string): string {
  const re = new RegExp(`${escapeRegExp(markerStart(projectId))}[\\s\\S]*?${escapeRegExp(MARKER_END)}`);
  if (re.test(rest)) return rest.replace(re, newBlock);
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
export function planHookFile(kind: HookKind, existing: string | null, projectId: string, rootAbs: string, detected: string, force = false): HookPlan {
  const newBlock = `${markerStart(projectId)}\n${blockBodyFor(kind, rootAbs, detected)}\n${MARKER_END}`;
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

/**
 * Installs (or refreshes) the `post-commit` and `commit-msg` hooks for `projectId` at `root`. `root` is the prdm
 * project root (used to `cd` before invoking `prdm`, and to locate `package.json`/`node_modules/.bin` for
 * detection); the hooks themselves are written wherever `git rev-parse --git-path hooks` points, which may be
 * outside `root` entirely (`core.hooksPath`), so this never goes through `safe-fs`.
 */
export async function installHooks(root: string, projectId: string, options: { force?: boolean } = {}): Promise<InstallHooksResult> {
  const hooksDir = await resolveHooksDir(root);
  const detected = await detectPrdmBin(root);
  const rootAbs = resolve(root);
  const result: InstallHooksResult = { installed: [], unchanged: [] };

  for (const kind of HOOK_KINDS) {
    const path = join(hooksDir, kind);
    const existing = await readIfExists(path);
    const plan = planHookFile(kind, existing, projectId, rootAbs, detected, options.force);
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
