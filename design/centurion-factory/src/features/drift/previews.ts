/**
 * Presentational helpers for the "Previews por rama" panel (SDD-070 D2/D3/D6), kept pure so the
 * component only renders what they return and the whole contract is unit-testable — the same split
 * `packages/app/src/routes/drift/previews.ts` uses (WO-636), minus the GitHub href: this mock has no
 * repository link and its rows are inert by design (see BranchPreviews).
 */

export interface BranchLabel {
  readonly label: string;
  readonly title: string;
}

// A `pull_request` GitHub Actions event reports its ref as `refs/pull/<N>/merge` (or `/head`), which
// the CLI stores verbatim as the report's `branch` (SDD-070 D3). Bare `<N>/merge` is the same value
// once Actions has stripped `refs/pull/`, so both spellings mean "this is PR #<N>".
const PR_REF = /^refs\/pull\/(\d+)\/(merge|head)$/;
const PR_SHORT = /^(\d+)\/merge$/;

function pullRequestNumber(branch: string): string | null {
  return PR_REF.exec(branch)?.[1] ?? PR_SHORT.exec(branch)?.[1] ?? null;
}

/** Turns a raw `branch` (as reported by CI) into a readable label, keeping the raw value for the title. */
export function branchLabel(branch: string | null): BranchLabel {
  if (branch === null) return { label: '(rama desconocida)', title: 'Rama del reporte: (desconocida)' };
  const number = pullRequestNumber(branch);
  return {
    label: number === null ? branch : `PR #${number}`,
    title: `Rama del reporte: ${branch}`,
  };
}

/** Issues gained (positive) or lost (negative) versus the official report; `null` with no reference. */
export function issueDelta(issueCount: number, referenceIssueCount: number | null): number | null {
  if (referenceIssueCount === null) return null;
  return issueCount - referenceIssueCount;
}

/** Signed absolute count, no thousands separator: `+154`, `-84`, `0`. */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export type DeltaTone = 'worse' | 'better' | 'same' | 'unknown';

/**
 * The second line of the count cell: `+2 vs main`. With no reference it names the branch and draws an
 * em dash instead of inventing a `0` (SDD-070 D2).
 */
export function deltaLine(delta: number | null, defaultBranch: string): string {
  return `${delta === null ? '—' : formatDelta(delta)} vs ${defaultBranch}`;
}

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
 * Worst-first ordering by delta against the reference, tie-broken by `issueCount` then `branch`
 * (SDD-070 D6). With no reference (`null`) there is nothing to sort by, so the reported order is
 * returned untouched. Never mutates the input.
 */
export function rankPreviews<T extends { readonly issueCount: number; readonly branch: string | null }>(
  previews: readonly T[],
  referenceIssueCount: number | null,
): readonly T[] {
  const copy = [...previews];
  if (referenceIssueCount === null) return copy;

  return copy.sort((a, b) => {
    const deltaDiff = issueDelta(b.issueCount, referenceIssueCount)! - issueDelta(a.issueCount, referenceIssueCount)!;
    if (deltaDiff !== 0) return deltaDiff;
    if (a.issueCount !== b.issueCount) return b.issueCount - a.issueCount;
    return compareBranches(a.branch, b.branch);
  });
}
