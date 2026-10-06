import { currentBranch, readCommitsInRange } from './git.js';

export type BranchRefKind = 'WO' | 'SDD' | 'PRD' | 'FR' | 'ADR' | 'BC';

export interface BranchRef {
  kind: BranchRefKind;
  id: string;
}

export interface BranchRefMismatch {
  sha: string;
  refs: string[];
  expected: string;
}

export interface BranchRefsCheck {
  branch: string | null;
  expected: string | null;
  mismatches: BranchRefMismatch[];
}

const BRANCH_REF = /(wo|sdd|prd|adr|fr|bc)-(\d+)/i;

/** Reads the doc id a branch declares in its last path segment (`fix/wo-447-x` -> WO-447), or null. */
export function parseBranchRef(branch: string): BranchRef | null {
  const segment = branch.split('/').at(-1) ?? '';
  const match = BRANCH_REF.exec(segment);
  if (!match) return null;
  const kind = match[1]!.toUpperCase() as BranchRefKind;
  return { kind, id: `${kind}-${match[2]}` };
}

/** Pure: only branches declaring a WO are checked; other kinds carry heterogeneous WOs on purpose. */
export function evaluateBranchRefs(
  branch: string | null,
  commits: readonly { sha: string; refs: readonly string[] }[],
): BranchRefsCheck {
  const declared = branch === null ? null : parseBranchRef(branch);
  if (declared === null || declared.kind !== 'WO') return { branch, expected: null, mismatches: [] };
  const expected = declared.id;
  const mismatches = commits
    .filter((commit) => !commit.refs.some((ref) => ref.toUpperCase() === expected))
    .map((commit) => ({ sha: commit.sha, refs: [...commit.refs], expected }));
  return { branch, expected, mismatches };
}

export async function checkBranchRefs(root: string, range: string): Promise<BranchRefsCheck> {
  const [branch, commits] = await Promise.all([currentBranch(root), readCommitsInRange(root, range)]);
  return evaluateBranchRefs(branch, commits);
}
