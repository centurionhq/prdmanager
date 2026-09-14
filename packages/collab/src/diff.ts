/**
 * Minimal LCS-based line differ (SDD-008 §"Versiones": "Diff por líneas entre versiones"). No dependency
 * added: the repository has no diff library anywhere else, and a document is capped at 512 KB rendered
 * (SDD-008 §"Servidor de tiempo real"), so a plain O(n*m) dynamic-programming LCS is more than fast
 * enough — pulling in a general-purpose diff library for this one line-level use would be overkill.
 */
export type LineDiffOpType = 'equal' | 'added' | 'removed';

export interface LineDiffOp {
  type: LineDiffOpType;
  line: string;
}

/**
 * Classic LCS backtrack: `table[i][j]` is the length of the longest common subsequence of `a[i:]` and
 * `b[j:]`. Produces the minimal edit script as a sequence of `equal`/`removed`/`added` ops, one per line
 * of `a`/`b` (never a paired "changed" op — a changed line surfaces as a `removed` immediately followed by
 * an `added`, which every consumer here already renders as a replacement).
 */
export function diffLines(a: string, b: string): LineDiffOp[] {
  const linesA = a.length === 0 ? [] : a.split('\n');
  const linesB = b.length === 0 ? [] : b.split('\n');

  const table: number[][] = Array.from({ length: linesA.length + 1 }, () => new Array<number>(linesB.length + 1).fill(0));
  for (let i = linesA.length - 1; i >= 0; i -= 1) {
    for (let j = linesB.length - 1; j >= 0; j -= 1) {
      table[i]![j] = linesA[i] === linesB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const ops: LineDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < linesA.length && j < linesB.length) {
    if (linesA[i] === linesB[j]) {
      ops.push({ type: 'equal', line: linesA[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ type: 'removed', line: linesA[i]! });
      i += 1;
    } else {
      ops.push({ type: 'added', line: linesB[j]! });
      j += 1;
    }
  }
  while (i < linesA.length) {
    ops.push({ type: 'removed', line: linesA[i]! });
    i += 1;
  }
  while (j < linesB.length) {
    ops.push({ type: 'added', line: linesB[j]! });
    j += 1;
  }

  return ops;
}
