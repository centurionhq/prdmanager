/**
 * Presentational helpers for the "Previews por rama" panel (SDD-070 D2/D3/D6, WO-636).
 *
 * Kept pure on purpose — no React, no JSX, no DOM, no styles — so the component (`PreviewsByBranch`,
 * WO-637) only has to render what these functions return and the whole contract is unit-testable.
 */

export type BranchKind = 'pull-request' | 'branch' | 'unknown';

export interface BranchDisplay {
  readonly label: string;
  readonly title: string;
  readonly href: string | null;
  readonly kind: BranchKind;
}

// A `pull_request` GitHub Actions event reports its ref as `refs/pull/<N>/merge` (or `/head`), which
// the CLI stores verbatim as the report's `branch` (SDD-070 D3). Bare `<N>/merge` is the same value
// once Actions has stripped `refs/pull/`, so both spellings mean "this is PR #<N>".
const PR_REF = /^refs\/pull\/(\d+)\/(merge|head)$/;
const PR_SHORT = /^(\d+)\/merge$/;
// `owner/repo`, both sides non-empty and slash-free. Anything else (empty, no slash, trailing slash)
// is not a repository we can build a GitHub URL from.
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/;

function pullRequestNumber(branch: string): string | null {
  return PR_REF.exec(branch)?.[1] ?? PR_SHORT.exec(branch)?.[1] ?? null;
}

function treeHref(repository: string | null, branch: string): string | null {
  if (!repository || !REPOSITORY.test(repository)) return null;
  // `encodeURI`, not `encodeURIComponent`: GitHub keeps the slashes of a branch name literal in the
  // path (`/tree/feat/algo`), while `encodeURIComponent` would turn them into `%2F` and 404. Only the
  // characters that would actually break the path (spaces, quotes, non-ASCII) get escaped.
  return `https://github.com/${repository}/tree/${encodeURI(branch)}`;
}

function pullHref(repository: string | null, number: string): string | null {
  if (!repository || !REPOSITORY.test(repository)) return null;
  return `https://github.com/${repository}/pull/${number}`;
}

/** Turns a raw `branch` (as reported by CI) into a readable label plus an optional GitHub link. */
export function branchDisplay(branch: string | null, githubRepository: string | null): BranchDisplay {
  if (branch === null) {
    return {
      label: '(rama desconocida)',
      title: 'Rama del reporte: (desconocida)',
      href: null,
      kind: 'unknown',
    };
  }

  const number = pullRequestNumber(branch);
  if (number !== null) {
    return {
      label: `PR #${number}`,
      title: `Rama del reporte: ${branch}`,
      href: pullHref(githubRepository, number),
      kind: 'pull-request',
    };
  }

  return {
    label: branch,
    title: `Rama del reporte: ${branch}`,
    href: treeHref(githubRepository, branch),
    kind: 'branch',
  };
}

/** Issues gained (positive) or lost (negative) versus the official report; `null` with no reference. */
export function issueDelta(reportIssueCount: number, referenceIssueCount: number | null): number | null {
  if (referenceIssueCount === null) return null;
  return reportIssueCount - referenceIssueCount;
}

/** Signed absolute count, no thousands separator: `+154`, `-84`, `0`. */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return `${delta}`;
}

export type DeltaTone = 'worse' | 'better' | 'same' | 'unknown';

export function deltaTone(delta: number | null): DeltaTone {
  if (delta === null) return 'unknown';
  if (delta > 0) return 'worse';
  if (delta < 0) return 'better';
  return 'same';
}

function compareBranches(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // no branch sorts last
  if (b === null) return -1;
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Worst-first ordering by delta against the reference, tie-broken by `issueCount` then `branch`.
 * With no reference (`null`) there is nothing to sort by, so the server's order is returned untouched.
 * Never mutates the input.
 */
export function rankPreviews<T extends { readonly issueCount: number; readonly branch: string | null }>(
  previews: readonly T[],
  referenceIssueCount: number | null,
): T[] {
  const copy = [...previews];
  if (referenceIssueCount === null) return copy;

  return copy.sort((a, b) => {
    const deltaDiff = issueDelta(b.issueCount, referenceIssueCount)! - issueDelta(a.issueCount, referenceIssueCount)!;
    if (deltaDiff !== 0) return deltaDiff;
    if (a.issueCount !== b.issueCount) return b.issueCount - a.issueCount;
    return compareBranches(a.branch, b.branch);
  });
}
