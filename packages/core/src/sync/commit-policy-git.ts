import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseProjectFile } from '../project/file.js';
import { findNestedProjectRoots } from '../project/discover.js';
import { parseDocument } from '../parser/frontmatter.js';
import type { Frontmatter } from '../domain/schema.js';
import { evaluateCommit, isGovernedPath, type EvaluateCommitResult, type PolicyDoc } from './commit-policy.js';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd: root, maxBuffer: MAX_BUFFER, encoding: 'utf8' });
    return stdout;
  } catch {
    return null;
  }
}

async function isAncestor(root: string, ancestor: string, ref: string): Promise<boolean> {
  try {
    await run('git', ['merge-base', '--is-ancestor', ancestor, ref], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

/** `true` when `enforceRefsSince` is unset, or `ref` (which must exist) descends from it. */
async function isWithinEnforcementRange(root: string, enforceRefsSince: string | null, ref: string): Promise<boolean> {
  if (!enforceRefsSince) return true;
  if ((await git(root, ['rev-parse', '-q', '--verify', ref])) === null) return false;
  return isAncestor(root, enforceRefsSince, ref);
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function splitZ(out: string | null): string[] {
  return out ? out.split('\0').filter((s) => s.length > 0) : [];
}

function splitLines(out: string | null): string[] {
  return out ? out.split('\n').map((s) => s.trim()).filter((s) => s.length > 0) : [];
}

/** `fromRef` omitted diffs the index against nothing (no `HEAD` yet): the canonical empty-tree sha is not guaranteed to exist in a fresh repository's object database, so it is never used as a literal ref. */
async function diffCachedNames(root: string, fromRef?: string): Promise<string[]> {
  const args = ['diff', '--cached', '--name-only', '--no-renames', '-z', ...(fromRef ? [fromRef] : [])];
  return splitZ(await git(root, args));
}

async function diffNamesBetween(root: string, fromRef: string, toRef: string): Promise<string[]> {
  return splitZ(await git(root, ['diff', '--name-only', '--no-renames', '-z', fromRef, toRef]));
}

/** The paths a commit introduces relative to its first parent, or to nothing when it is a root commit. */
async function changedPathsForCommit(root: string, parent1: string | undefined, sha: string): Promise<string[]> {
  if (!parent1) return splitZ(await git(root, ['show', '--no-renames', '--name-only', '--format=', '-z', sha]));
  return diffNamesBetween(root, parent1, sha);
}

/**
 * `ref === 'INDEX'` lists the staged tree; any other ref is a commit-ish (`HEAD`, a sha, `HEAD^`, ...).
 * `ls-tree`'s trailing arguments are literal paths, not pathspecs (unlike `ls-files`/`diff`), so the `.md` filter
 * is applied here in JS rather than passed to git.
 */
async function markdownPathsAt(root: string, ref: string): Promise<string[]> {
  if (ref === 'INDEX') return splitLines(await git(root, ['ls-files', '--cached', '--', '*.md']));
  return splitLines(await git(root, ['ls-tree', '-r', '--name-only', ref])).filter((path) => path.endsWith('.md'));
}

function blobSpec(ref: string, path: string): string {
  return ref === 'INDEX' ? `:${path}` : `${ref}:${path}`;
}

function toPolicyDoc(fm: Frontmatter): PolicyDoc | null {
  if (fm.type === 'SDD' || fm.type === 'ADR') return { type: fm.type, id: fm.id, impactsPaths: fm.impacts_paths };
  if (fm.type === 'WO') return { type: 'WO', id: fm.id, status: fm.status, implements: fm.implements };
  return null;
}

function isInsideNested(path: string, nestedRoots: readonly string[]): boolean {
  return nestedRoots.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/** A subdirectory with its own `.prdm.yaml` is a separate project (SDD-002 "Proyecto activo") and is never governed here. */
function excludeNested(paths: readonly string[], nestedRoots: readonly string[]): string[] {
  return paths.filter((path) => !isInsideNested(path, nestedRoots));
}

/** Reads and parses every SDD/ADR/WO document reachable at `ref`, excluding nested projects. */
async function policyDocsAt(root: string, ref: string, paths: readonly string[], nestedRoots: readonly string[]): Promise<PolicyDoc[]> {
  const docs: PolicyDoc[] = [];
  for (const path of paths) {
    if (isInsideNested(path, nestedRoots)) continue;
    const content = await git(root, ['show', blobSpec(ref, path)]);
    if (content === null) continue;
    const parsed = parseDocument(content, path);
    if (!parsed || !parsed.ok) continue;
    const doc = toPolicyDoc(parsed.doc.frontmatter);
    if (doc) docs.push(doc);
  }
  return docs;
}

export interface CommitMsgCheckOptions {
  /** Best-effort `--amend` detection (SDD-002 "Ciclo de vida": CI's range check is the authority for amends). */
  amend?: boolean;
}

/**
 * Evaluates the commit that `git commit` is about to create from the current index, for the `commit-msg` hook.
 * Returns `{ ok: true, ... }` immediately (no git/project state is read) when the project has no `.prdm.yaml`.
 */
export async function checkCommitMessage(root: string, message: string, options: CommitMsgCheckOptions = {}): Promise<EvaluateCommitResult> {
  const settingsRaw = await readTextFile(join(root, '.prdm.yaml'));
  if (settingsRaw === null) return { ok: true, requiredFor: [], refs: [] };
  const settings = parseProjectFile(settingsRaw);

  const hasHead = (await git(root, ['rev-parse', '-q', '--verify', 'HEAD'])) !== null;
  const diffBase = options.amend && hasHead ? 'HEAD^' : hasHead ? 'HEAD' : undefined;
  const nestedRoots = await findNestedProjectRoots(root, settings.ignore);
  const changedPaths = excludeNested(await diffCachedNames(root, diffBase), nestedRoots);

  const isMerge = (await git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) !== null;
  const docsAtHead = hasHead ? await policyDocsAt(root, 'HEAD', await markdownPathsAt(root, 'HEAD'), nestedRoots) : [];
  const docsInIndex = await policyDocsAt(root, 'INDEX', await markdownPathsAt(root, 'INDEX'), nestedRoots);
  const allDocs = [...docsAtHead, ...docsInIndex];

  const hasConflictsInGoverned = isMerge && (await hasGovernedConflicts(root, changedPaths, allDocs, 'MERGE_HEAD'));
  const withinRange = await isWithinEnforcementRange(root, settings.git.enforceRefsSince, 'HEAD');

  return evaluateCommit({
    changedPaths,
    message,
    isMerge,
    hasConflictsInGoverned,
    docsAtHead,
    docsInIndex,
    settings: { enforceRefs: settings.git.enforceRefs, isWithinEnforcementRange: withinRange },
  });
}

async function hasGovernedConflicts(root: string, changedPaths: readonly string[], docs: readonly PolicyDoc[], otherParent: string): Promise<boolean> {
  const fromOtherParent = await diffCachedNames(root, otherParent);
  const conflicted = changedPaths.filter((p) => fromOtherParent.includes(p));
  return conflicted.some((p) => isGovernedPath(p, docs));
}

export interface CommitRangeEntry {
  sha: string;
  result: EvaluateCommitResult;
}

export interface CommitRangeCheck {
  ok: boolean;
  commits: CommitRangeEntry[];
  grandfatheredGrowthMessage?: string;
}

function splitRange(range: string): [string, string] {
  const idx = range.indexOf('..');
  if (idx === -1) throw new Error(`invalid range "${range}" (expected "<base>..<head>")`);
  return [range.slice(0, idx), range.slice(idx + 2)];
}

async function evaluateHistoricalCommit(
  root: string,
  sha: string,
  settings: { enforceRefs: boolean; enforceRefsSince: string | null },
  nestedRoots: readonly string[],
): Promise<EvaluateCommitResult> {
  const parents = splitLines(await git(root, ['rev-list', '--parents', '-n', '1', sha]))[0]?.split(/\s+/) ?? [sha];
  const [, parent1, parent2] = parents;
  const changedPaths = excludeNested(await changedPathsForCommit(root, parent1, sha), nestedRoots);
  const isMerge = parent2 !== undefined;

  const docsAtHead = parent1 ? await policyDocsAt(root, parent1, await markdownPathsAt(root, parent1), nestedRoots) : [];
  const docsInIndex = await policyDocsAt(root, sha, await markdownPathsAt(root, sha), nestedRoots);
  const allDocs = [...docsAtHead, ...docsInIndex];

  let hasConflictsInGoverned = false;
  if (isMerge && parent1 && parent2) {
    const fromP1 = await diffNamesBetween(root, parent1, sha);
    const fromP2 = await diffNamesBetween(root, parent2, sha);
    hasConflictsInGoverned = fromP1.filter((p) => fromP2.includes(p)).some((p) => isGovernedPath(p, allDocs));
  }

  const withinRange = await isWithinEnforcementRange(root, settings.enforceRefsSince, sha);
  const message = (await git(root, ['log', '-1', '--format=%B', sha])) ?? '';
  return evaluateCommit({
    changedPaths,
    message,
    isMerge,
    hasConflictsInGoverned,
    docsAtHead,
    docsInIndex,
    settings: { enforceRefs: settings.enforceRefs, isWithinEnforcementRange: withinRange },
  });
}

async function settingsAtRef(root: string, ref: string): Promise<string | null> {
  return (await git(root, ['show', `${ref}:.prdm.yaml`])) ?? (await readTextFile(join(root, '.prdm.yaml')));
}

async function grandfatheredGrew(root: string, baseRaw: string, headRef: string): Promise<boolean> {
  const baseCount = parseProjectFile(baseRaw).lifecycle.grandfathered.length;
  const headRaw = await settingsAtRef(root, headRef);
  if (headRaw === null) return false;
  try {
    return parseProjectFile(headRaw).lifecycle.grandfathered.length > baseCount;
  } catch {
    return false;
  }
}

/**
 * CI mode (`prdm check commits --range <base>..<head>`): evaluates every commit in the range independently, each
 * against its own first parent and its own document state, using policy settings read from `.prdm.yaml` at `base`
 * (falling back to the working tree). Also fails when `lifecycle.grandfathered` grew relative to `base`.
 */
export async function checkCommitRange(root: string, range: string): Promise<CommitRangeCheck> {
  const [baseRef, headRef] = splitRange(range);
  const baseRaw = await settingsAtRef(root, baseRef);
  if (baseRaw === null) return { ok: true, commits: [] };
  const settings = parseProjectFile(baseRaw);
  const nestedRoots = await findNestedProjectRoots(root, settings.ignore);

  const shas = splitLines(await git(root, ['rev-list', '--reverse', range]));
  const commits: CommitRangeEntry[] = [];
  for (const sha of shas) commits.push({ sha, result: await evaluateHistoricalCommit(root, sha, settings.git, nestedRoots) });

  const grew = await grandfatheredGrew(root, baseRaw, headRef);
  const ok = commits.every((c) => c.result.ok) && !grew;
  return { ok, commits, grandfatheredGrowthMessage: grew ? `lifecycle.grandfathered grew relative to ${baseRef}` : undefined };
}

/** `origin/<default-branch>..<headSha>`, used by CI when `before` is all-zeros (first push of a new branch). */
export async function resolveDefaultBranchRange(root: string, headSha: string): Promise<string> {
  const symbolic = await git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  const branch = symbolic ? symbolic.trim().replace(/^refs\/remotes\//, '') : 'origin/main';
  return `${branch}..${headSha}`;
}
