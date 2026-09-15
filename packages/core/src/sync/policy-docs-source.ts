/**
 * `PolicyDocsSource` seam (SDD-010 "Política Refs:", WO-196): the one thing `checkCommitMessage`/
 * `checkCommitRange` used to hard-code as "read from local git" — parsed SDD/ADR/WO policy documents and
 * `.prdm.yaml`-equivalent settings at a given ref — is now an injectable dependency. `GitPolicyDocsSource`
 * is the exact same git-blob-reading behavior this module always had, wired as the *default* so local
 * mode's behavior is provably unchanged (see this file's own tests: the full pre-existing local-mode
 * commit-check suite passes unchanged against it). A future remote-mode source (WO-197/WO-198) can
 * implement the same three methods against the WO-195 governance cache/server instead of git, without
 * `checkCommitMessage`/`checkCommitRange` themselves ever needing to know the difference.
 *
 * Everything else `checkCommitMessage`/`checkCommitRange` do — which *code* paths changed, commit
 * structure/parents, commit messages — stays local-git-specific in `commit-policy-git.ts`: those are
 * about the repository's own tracked code, not about where policy documents live, and are unaffected by
 * this seam.
 */
import picomatch from 'picomatch';
import { parseProjectFile, type ProjectFileSettings } from '../project/file.js';
import { parseDocument } from '../parser/frontmatter.js';
import type { Frontmatter } from '../domain/schema.js';
import type { PolicyDoc } from './commit-policy.js';

export interface PolicyDocsSource {
  /** Parsed SDD/ADR/WO documents reachable at `ref` (`'INDEX'` for the staged tree), excluding any path
   * inside `nestedRoots`. */
  policyDocsAt(ref: string, nestedRoots: readonly string[]): Promise<PolicyDoc[]>;
  /** Project-relative subdirectories with their own `.prdm.yaml` at `ref`, excluding `ignore`-matched paths
   * (SDD-002 "Proyecto activo": a nested project is never governed by its parent). */
  nestedProjectRootsAt(ref: string, ignore: readonly string[]): Promise<string[]>;
  /** Parsed `.prdm.yaml`-equivalent settings at `ref`, or `null` when none exists there. */
  settingsAt(ref: string): Promise<ProjectFileSettings | null>;
}

function toPolicyDoc(fm: Frontmatter): PolicyDoc | null {
  if (fm.type === 'SDD' || fm.type === 'ADR') return { type: fm.type, id: fm.id, impactsPaths: fm.impacts_paths };
  if (fm.type === 'WO') return { type: 'WO', id: fm.id, status: fm.status, implements: fm.implements };
  return null;
}

/** A subdirectory with its own `.prdm.yaml` is a separate project (SDD-002 "Proyecto activo") and is
 * never governed by its parent — shared with `commit-policy-git.ts`'s own `excludeNested`. */
export function isInsideNested(path: string, nestedRoots: readonly string[]): boolean {
  return nestedRoots.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

export interface GitPolicyDocsSourceDeps {
  /** Lenient git invocation: `null` on a non-zero exit (missing ref, no match, ...), never throws. */
  git(args: string[]): Promise<string | null>;
  /** Repo-top-level-relative prefix down to the project root (WO-024 finding 2), resolved once. */
  prefix(): Promise<string>;
}

function splitZ(out: string | null): string[] {
  return out ? out.split('\0').filter((s) => s.length > 0) : [];
}

/** `<rev>:<path>` blob specs are always resolved relative to the repo top-level. */
function blobSpec(ref: string, prefix: string, path: string): string {
  return ref === 'INDEX' ? `:${prefix}${path}` : `${ref}:${prefix}${path}`;
}

/** The exact git-blob-reading behavior this module always had (`markdownPathsAt` + `policyDocsAt` +
 * `nestedProjectRootsAtRef` + `settingsAtRef`, unchanged) — wired via `deps` so `commit-policy-git.ts` can
 * supply its own already-hardened `git`/`prefix` helpers instead of this module re-deriving them. */
export class GitPolicyDocsSource implements PolicyDocsSource {
  constructor(private readonly deps: GitPolicyDocsSourceDeps) {}

  private async markdownPathsAt(ref: string): Promise<string[]> {
    if (ref === 'INDEX') return splitZ(await this.deps.git(['ls-files', '--cached', '-z', '--', '*.md']));
    return splitZ(await this.deps.git(['ls-tree', '-r', '-z', '--name-only', ref])).filter((path) => path.endsWith('.md'));
  }

  async policyDocsAt(ref: string, nestedRoots: readonly string[]): Promise<PolicyDoc[]> {
    const prefix = await this.deps.prefix();
    const paths = await this.markdownPathsAt(ref);
    const docs: PolicyDoc[] = [];
    for (const path of paths) {
      if (isInsideNested(path, nestedRoots)) continue;
      const content = await this.deps.git(['show', blobSpec(ref, prefix, path)]);
      if (content === null) continue;
      const parsed = parseDocument(content, path);
      if (!parsed || !parsed.ok) continue;
      const doc = toPolicyDoc(parsed.doc.frontmatter);
      if (doc) docs.push(doc);
    }
    return docs;
  }

  async nestedProjectRootsAt(ref: string, ignore: readonly string[]): Promise<string[]> {
    const paths = splitZ(await this.deps.git(['ls-tree', '-r', '-z', '--name-only', ref]));
    const suffix = '/.prdm.yaml';
    const isIgnored = ignore.length > 0 ? picomatch([...ignore]) : (): boolean => false;
    return paths
      .filter((path) => path.endsWith(suffix) && !isIgnored(path))
      .map((path) => path.slice(0, -suffix.length))
      .sort();
  }

  async settingsAt(ref: string): Promise<ProjectFileSettings | null> {
    const prefix = await this.deps.prefix();
    const raw = await this.deps.git(['show', `${ref}:${prefix}.prdm.yaml`]);
    return raw === null ? null : parseProjectFile(raw);
  }
}
