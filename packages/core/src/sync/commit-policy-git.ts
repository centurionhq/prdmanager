import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import picomatch from 'picomatch';
import { parseProjectFile, type ProjectFileSettings } from '../project/file.js';
import { DEFAULT_LIFECYCLE } from '../project/types.js';
import { findNestedProjectRoots } from '../project/discover.js';
import { parseDocument } from '../parser/frontmatter.js';
import type { Frontmatter } from '../domain/schema.js';
import { parseRefs } from './git.js';
import { evaluateCommit, isGovernedPath, isPathCoveredByRefs, type EvaluateCommitResult, type PolicyDoc } from './commit-policy.js';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
/** Forced on every invocation (WO-024 finding 1c): with `-z`-terminated output this is belt-and-suspenders, since
 * `-z` already disables C-style quoting of non-ASCII paths regardless of `core.quotepath`. */
const GLOBAL_GIT_ARGS = ['-c', 'core.quotepath=false'];

async function runGit(root: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', [...GLOBAL_GIT_ARGS, ...args], { cwd: root, maxBuffer: MAX_BUFFER, encoding: 'utf8' });
  return stdout;
}

/** Lenient: a non-zero exit (missing ref, no match, ...) is a meaningful "nothing here", returned as `null`. */
async function git(root: string, args: string[]): Promise<string | null> {
  try {
    return await runGit(root, args);
  } catch {
    return null;
  }
}

/**
 * Strict (WO-024 finding 3): a non-zero exit is a hard failure and throws. Only ever call this for commands whose
 * failure genuinely means something is wrong (an invalid range, an unreachable sha, ...) rather than "no results" -
 * git already reports "no results" as a successful, empty stdout for the commands used this way here.
 */
async function gitStrict(root: string, args: string[]): Promise<string> {
  try {
    return await runGit(root, args);
  } catch (err) {
    const stderr = (err as { stderr?: unknown }).stderr;
    const detail = typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : (err as Error).message;
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

async function isAncestor(root: string, ancestor: string, ref: string): Promise<boolean> {
  try {
    await run('git', [...GLOBAL_GIT_ARGS, 'merge-base', '--is-ancestor', ancestor, ref], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

/**
 * `true` unless `ref` is part of the history up to `enforceRefsSince` (the adoption point). Only commits reachable
 * from that sha are exempt: a branch forked from older history and merged later is still enforced.
 */
async function isWithinEnforcementRange(root: string, enforceRefsSince: string | null, ref: string): Promise<boolean> {
  if (!enforceRefsSince) return true;
  if ((await git(root, ['rev-parse', '-q', '--verify', ref])) === null) return true;
  if ((await git(root, ['rev-parse', '-q', '--verify', `${enforceRefsSince}^{commit}`])) === null) return true;
  return !(await isAncestor(root, ref, enforceRefsSince));
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

/**
 * `git rev-parse --show-prefix`, trimmed: empty when `root` (the prdm project root) is itself the git top-level,
 * otherwise the trailing-slash-terminated path from the top-level down to `root` (WO-024 finding 2). Every path
 * git reports from a diff/show-style command is relative to the top-level regardless of `cwd`, so this prefix is
 * what turns those repo-relative paths into the project-relative ones the rest of this module expects.
 */
async function projectPrefix(root: string): Promise<string> {
  const out = await git(root, ['rev-parse', '--show-prefix']);
  return out ? out.trim() : '';
}

/** Repo-relative -> project-relative: drops anything outside `prefix` and strips it from the rest. */
function stripPrefix(prefix: string, paths: readonly string[]): string[] {
  if (!prefix) return [...paths];
  return paths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
}

/**
 * `fromRef` omitted diffs the index against nothing (no `HEAD` yet, or a root commit being amended): the canonical
 * empty-tree sha is not guaranteed to exist in a fresh repository's object database, so it is never used as a
 * literal ref. No pathspec is passed to restrict this to the project subtree: a bare pathspec after `--` is
 * resolved relative to `cwd` (which is already the project root when it is a repo subdirectory), not the repo
 * top-level, so it cannot be combined with `prefix` (a top-level-relative path) here - filtering happens entirely
 * in {@link stripPrefix} instead, on the repo-root-relative paths git itself reports.
 */
async function diffCachedNames(root: string, prefix: string, fromRef?: string): Promise<string[]> {
  const args = ['diff', '--cached', '--name-only', '--no-renames', '-z', ...(fromRef ? [fromRef] : [])];
  return stripPrefix(prefix, splitZ(await gitStrict(root, args)));
}

async function diffNamesBetween(root: string, prefix: string, fromRef: string, toRef: string): Promise<string[]> {
  const args = ['diff', '--name-only', '--no-renames', '-z', fromRef, toRef];
  return stripPrefix(prefix, splitZ(await gitStrict(root, args)));
}

/** The paths a commit introduces relative to its first parent, or to nothing when it is a root commit. */
async function changedPathsForCommit(root: string, prefix: string, parent1: string | undefined, sha: string): Promise<string[]> {
  if (!parent1) {
    const args = ['show', '--no-renames', '--name-only', '--format=', '-z', sha];
    return stripPrefix(prefix, splitZ(await gitStrict(root, args)));
  }
  return diffNamesBetween(root, prefix, parent1, sha);
}

/**
 * `ref === 'INDEX'` lists the staged tree; any other ref is a commit-ish (`HEAD`, a sha, `HEAD^`, ...). Both
 * `ls-tree` and `ls-files` implicitly restrict themselves to (and report paths relative to) `cwd`, so when `root`
 * is a subdirectory of the git repository (WO-024 finding 2) these are already project-relative with no further
 * work. `-z` (WO-024 finding 1c) keeps non-ASCII paths intact regardless of `core.quotepath`.
 */
async function markdownPathsAt(root: string, ref: string): Promise<string[]> {
  if (ref === 'INDEX') return splitZ(await git(root, ['ls-files', '--cached', '-z', '--', '*.md']));
  return splitZ(await git(root, ['ls-tree', '-r', '-z', '--name-only', ref])).filter((path) => path.endsWith('.md'));
}

/** `<rev>:<path>` blob specs are always resolved relative to the repo top-level, so `prefix` (project-relative ->
 * repo-relative) must be re-applied here even though it was already stripped from `path` itself. */
function blobSpec(ref: string, prefix: string, path: string): string {
  return ref === 'INDEX' ? `:${prefix}${path}` : `${ref}:${prefix}${path}`;
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

/**
 * Root-relative-to-`root` project subdirectories with their own `.prdm.yaml` at `ref` (WO-024 finding 1b): computed
 * from `git ls-tree`, never from the live working tree, so a nested project declared inside the very range being
 * checked cannot retroactively exempt paths that were governed at `ref`.
 */
async function nestedProjectRootsAtRef(root: string, ref: string, ignore: readonly string[]): Promise<string[]> {
  const paths = splitZ(await git(root, ['ls-tree', '-r', '-z', '--name-only', ref]));
  const suffix = '/.prdm.yaml';
  const isIgnored = ignore.length > 0 ? picomatch([...ignore]) : (): boolean => false;
  return paths
    .filter((path) => path.endsWith(suffix) && !isIgnored(path))
    .map((path) => path.slice(0, -suffix.length))
    .sort();
}

/** Reads and parses every SDD/ADR/WO document reachable at `ref`, excluding nested projects. */
async function policyDocsAt(root: string, prefix: string, ref: string, paths: readonly string[], nestedRoots: readonly string[]): Promise<PolicyDoc[]> {
  const docs: PolicyDoc[] = [];
  for (const path of paths) {
    if (isInsideNested(path, nestedRoots)) continue;
    const content = await git(root, ['show', blobSpec(ref, prefix, path)]);
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
  const prefix = await projectPrefix(root);

  const hasHead = (await git(root, ['rev-parse', '-q', '--verify', 'HEAD'])) !== null;
  // Amending the repository's very first commit has no `HEAD^`: diff against nothing (WO-024 finding 6), exactly
  // like the "no HEAD yet" case below, rather than assuming a parent that does not exist.
  const headHasParent = hasHead && (await git(root, ['rev-parse', '-q', '--verify', 'HEAD^'])) !== null;
  const diffBase = !hasHead ? undefined : options.amend ? (headHasParent ? 'HEAD^' : undefined) : 'HEAD';
  const nestedRoots = await findNestedProjectRoots(root, settings.ignore);
  const changedPaths = excludeNested(await diffCachedNames(root, prefix, diffBase), nestedRoots);

  const isMerge = (await git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) !== null;
  const docsAtHead = hasHead ? await policyDocsAt(root, prefix, 'HEAD', await markdownPathsAt(root, 'HEAD'), nestedRoots) : [];
  const docsInIndex = await policyDocsAt(root, prefix, 'INDEX', await markdownPathsAt(root, 'INDEX'), nestedRoots);
  const allDocs = [...docsAtHead, ...docsInIndex];

  const hasConflictsInGoverned = isMerge && (await hasGovernedConflicts(root, prefix, changedPaths, allDocs, 'MERGE_HEAD'));
  // The commit being created is new, so it can never belong to the history up to `enforce_refs_since`.
  const withinRange = true;

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

async function hasGovernedConflicts(
  root: string,
  prefix: string,
  changedPaths: readonly string[],
  docs: readonly PolicyDoc[],
  otherParent: string,
): Promise<boolean> {
  const fromOtherParent = await diffCachedNames(root, prefix, otherParent);
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
  /** Root commits found inside the range (i.e. not the range base itself) - an unrelated-history graft or "evil merge" (WO-024 finding 1d). */
  orphanCommitsMessage?: string;
  /** Governed paths changed between the range's base and head that no single non-merge commit's "Refs:" trailer covers (WO-024 finding 1d). */
  uncoveredPathsMessage?: string;
  /** Set when the range base has no `.prdm.yaml`: there is no policy to enforce yet (e.g. the PR that adopts prdm). */
  notEnforcedMessage?: string;
}

function splitRange(range: string): [string, string] {
  const idx = range.indexOf('..');
  if (idx === -1) throw new Error(`invalid range "${range}" (expected "<base>..<head>")`);
  return [range.slice(0, idx), range.slice(idx + 2)];
}

async function commitParents(root: string, sha: string): Promise<string[]> {
  const line = splitLines(await gitStrict(root, ['rev-list', '--parents', '-n', '1', sha]))[0] ?? sha;
  return line.split(/\s+/).slice(1);
}

/**
 * Evaluates one historical commit in a range. Blueprints come from the union of every ref inspected across the
 * range, so a blueprint deleted-then-restored mid-range still governs every commit in between (WO-024 finding 1a).
 * Work orders come only from the commit's first parent and the commit itself: a `Refs:` trailer is valid when the
 * WO was open when the commit was made, regardless of later completion, and a WO absent from both trees (deleted to
 * hide it) cannot validate anything.
 */
async function evaluateHistoricalCommit(
  root: string,
  prefix: string,
  sha: string,
  parents: readonly string[],
  gitSettings: { enforceRefs: boolean; enforceRefsSince: string | null },
  nestedRoots: readonly string[],
  rangeBlueprints: readonly PolicyDoc[],
  docsAt: (ref: string) => Promise<PolicyDoc[]>,
): Promise<EvaluateCommitResult> {
  const [parent1, parent2] = parents;
  const changedPaths = excludeNested(await changedPathsForCommit(root, prefix, parent1, sha), nestedRoots);
  const isMerge = parent2 !== undefined;

  let hasConflictsInGoverned = false;
  if (isMerge && parent1 && parent2) {
    const fromP1 = await diffNamesBetween(root, prefix, parent1, sha);
    const fromP2 = await diffNamesBetween(root, prefix, parent2, sha);
    hasConflictsInGoverned = fromP1.filter((p) => fromP2.includes(p)).some((p) => isGovernedPath(p, rangeBlueprints));
  }

  const withinRange = await isWithinEnforcementRange(root, gitSettings.enforceRefsSince, sha);
  const message = (await git(root, ['log', '-1', '--format=%B', sha])) ?? '';
  const workOrdersOf = (docs: readonly PolicyDoc[]): PolicyDoc[] => docs.filter((doc) => doc.type === 'WO');
  const parentWorkOrders = parent1 ? workOrdersOf(await docsAt(parent1)) : [];
  return evaluateCommit({
    changedPaths,
    message,
    isMerge,
    hasConflictsInGoverned,
    docsAtHead: [...rangeBlueprints, ...parentWorkOrders],
    docsInIndex: workOrdersOf(await docsAt(sha)),
    settings: { enforceRefs: gitSettings.enforceRefs, isWithinEnforcementRange: withinRange },
  });
}

/**
 * Reads `.prdm.yaml` at `ref` via `git show`, parsed. Returns `null` only when `ref` genuinely has no `.prdm.yaml`
 * (a normal, successful "not found") - never falls back to the live working tree (WO-024 finding 1e): a base
 * commit predating `.prdm.yaml` must fall back to schema defaults, not to whatever a PR's own checkout carries.
 */
async function settingsAtRef(root: string, prefix: string, ref: string): Promise<ProjectFileSettings | null> {
  const raw = await git(root, ['show', `${ref}:${prefix}.prdm.yaml`]);
  return raw === null ? null : parseProjectFile(raw);
}

/**
 * `true` when `lifecycle.grandfathered` at `headRef` contains an `{ id, hash }` pair absent from `base` (WO-024
 * finding 5): comparing the *set* rather than just the count also catches swapping the hash of an id that was
 * already grandfathered. Removing entries is always fine.
 */
async function grandfatheredGrew(root: string, prefix: string, baseSettings: ProjectFileSettings | null, headRef: string): Promise<boolean> {
  const baseEntries = baseSettings?.lifecycle.grandfathered ?? DEFAULT_LIFECYCLE.grandfathered;
  const baseSet = new Set(baseEntries.map((entry) => `${entry.id}:${entry.hash}`));
  let headSettings: ProjectFileSettings | null;
  try {
    headSettings = await settingsAtRef(root, prefix, headRef);
  } catch {
    return false;
  }
  if (headSettings === null) return false;
  return headSettings.lifecycle.grandfathered.some((entry) => !baseSet.has(`${entry.id}:${entry.hash}`));
}

/** Every ref whose document state matters for the range: the base tree, every commit in the range, and each commit's parent(s) (WO-024 finding 1a). */
function collectRangeRefs(baseRef: string, shas: readonly string[], parentsBySha: ReadonlyMap<string, readonly string[]>): string[] {
  const refs = new Set<string>([baseRef, ...shas]);
  for (const parents of parentsBySha.values()) for (const parent of parents) refs.add(parent);
  return [...refs];
}

/** Memoized per-ref policy documents: every ref is read from git at most once per range check. */
function policyDocsCache(root: string, prefix: string, nestedRoots: readonly string[]): (ref: string) => Promise<PolicyDoc[]> {
  const cache = new Map<string, Promise<PolicyDoc[]>>();
  return (ref) => {
    let docs = cache.get(ref);
    if (!docs) {
      docs = markdownPathsAt(root, ref).then((paths) => policyDocsAt(root, prefix, ref, paths, nestedRoots));
      cache.set(ref, docs);
    }
    return docs;
  };
}

/**
 * Aggregate coverage check (WO-024 finding 1d, minimum requirement): every governed path changed between the
 * range's base and head must be touched by at least one *non-merge* commit in the range whose message carries a
 * valid `Refs:` trailer for a WO governing that path. This catches drift a merge commit introduces beyond what any
 * individual commit's own diff carries (an "evil merge"), which per-commit evaluation alone cannot see.
 */
async function aggregateCoverageCheck(
  root: string,
  prefix: string,
  baseRef: string,
  headRef: string,
  shas: readonly string[],
  parentsBySha: ReadonlyMap<string, readonly string[]>,
  nestedRoots: readonly string[],
  allDocs: readonly PolicyDoc[],
  gitSettings: { enforceRefs: boolean; enforceRefsSince: string | null },
): Promise<{ ok: boolean; message?: string }> {
  if (!gitSettings.enforceRefs) return { ok: true };
  const finalChanged = excludeNested(await diffNamesBetween(root, prefix, baseRef, headRef), nestedRoots);
  const governedFinal = finalChanged.filter((path) => isGovernedPath(path, allDocs));
  if (governedFinal.length === 0) return { ok: true };

  const nonMergeCommits: { paths: Set<string>; refs: string[]; exempt?: boolean }[] = [];
  for (const sha of shas) {
    const parents = parentsBySha.get(sha) ?? [];
    if (parents.length !== 1) continue;
    if (!(await isWithinEnforcementRange(root, gitSettings.enforceRefsSince, sha))) {
      const exemptPaths = await changedPathsForCommit(root, prefix, parents[0], sha);
      nonMergeCommits.push({ paths: new Set(exemptPaths), refs: [], exempt: true });
      continue;
    }
    const changed = excludeNested(await changedPathsForCommit(root, prefix, parents[0], sha), nestedRoots);
    const message = (await git(root, ['log', '-1', '--format=%B', sha])) ?? '';
    nonMergeCommits.push({ paths: new Set(changed), refs: parseRefs(message) });
  }

  const uncovered = governedFinal
    .filter((path) => !nonMergeCommits.some((commit) => commit.paths.has(path) && (commit.exempt === true || isPathCoveredByRefs(path, commit.refs, allDocs))))
    .sort();
  if (uncovered.length === 0) return { ok: true };
  return { ok: false, message: `governed path(s) not covered by any single commit's "Refs:" trailer: ${uncovered.join(', ')}` };
}

/**
 * CI mode (`prdm check commits --range <base>..<head>`): evaluates every commit in the range against the union of
 * document state across the whole range (WO-024 finding 1a), using nested project roots and policy settings fixed
 * at the base tree (finding 1b/1e), supports a project root inside a subdirectory of the repository (finding 2),
 * fails loudly on git errors instead of silently passing (finding 3), rejects orphan root commits and runs an
 * aggregate coverage check across the whole range (finding 1d), and fails when `lifecycle.grandfathered` gained any
 * `{ id, hash }` pair relative to `base` (finding 5).
 */
export async function checkCommitRange(root: string, range: string): Promise<CommitRangeCheck> {
  const [baseRef, headRef] = splitRange(range);
  const prefix = await projectPrefix(root);

  const shas = splitLines(await gitStrict(root, ['rev-list', '--reverse', range]));
  const parentsBySha = new Map<string, string[]>();
  for (const sha of shas) parentsBySha.set(sha, await commitParents(root, sha));

  const orphanShas = shas.filter((sha) => (parentsBySha.get(sha) ?? []).length === 0);
  const nonOrphanShas = shas.filter((sha) => !orphanShas.includes(sha));

  const baseSettings = await settingsAtRef(root, prefix, baseRef);
  if (baseSettings === null) {
    // Enforcement is defined by the base: a base without .prdm.yaml has no policy a PR could weaken (adoption PRs).
    return { ok: true, commits: [], notEnforcedMessage: `${baseRef} has no .prdm.yaml; Refs enforcement starts once it is merged` };
  }
  const gitSettings = baseSettings.git;
  const nestedRoots = await nestedProjectRootsAtRef(root, baseRef, baseSettings.ignore);
  const docsAt = policyDocsCache(root, prefix, nestedRoots);

  const rangeRefs = [...collectRangeRefs(baseRef, shas, parentsBySha), headRef];
  const allDocs = (await Promise.all(rangeRefs.map(docsAt))).flat();
  const rangeBlueprints = allDocs.filter((doc) => doc.type !== 'WO');

  const commits: CommitRangeEntry[] = [];
  for (const sha of nonOrphanShas) {
    const result = await evaluateHistoricalCommit(root, prefix, sha, parentsBySha.get(sha) ?? [], gitSettings, nestedRoots, rangeBlueprints, docsAt);
    commits.push({ sha, result });
  }

  const aggregate = await aggregateCoverageCheck(root, prefix, baseRef, headRef, nonOrphanShas, parentsBySha, nestedRoots, allDocs, gitSettings);
  const grew = await grandfatheredGrew(root, prefix, baseSettings, headRef);

  const orphanCommitsMessage =
    orphanShas.length > 0 ? `orphan root commit(s) found inside the range (only the range base may be a root commit): ${orphanShas.join(', ')}` : undefined;

  const ok = orphanShas.length === 0 && commits.every((c) => c.result.ok) && !grew && aggregate.ok;
  return {
    ok,
    commits,
    grandfatheredGrowthMessage: grew ? `lifecycle.grandfathered grew relative to ${baseRef}` : undefined,
    orphanCommitsMessage,
    uncoveredPathsMessage: aggregate.ok ? undefined : aggregate.message,
  };
}

/** `origin/<default-branch>..<headSha>`, used by CI when `before` is all-zeros (first push of a new branch). */
export async function resolveDefaultBranchRange(root: string, headSha: string): Promise<string> {
  const symbolic = await git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  const branch = symbolic ? symbolic.trim().replace(/^refs\/remotes\//, '') : 'origin/main';
  return `${branch}..${headSha}`;
}
