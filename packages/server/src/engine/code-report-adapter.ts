/**
 * Pure adapter from a client-submitted `CodeReportRequest` (`@prdm/contracts`, SDD-010) to `@prdm/core`'s
 * `DriftInput` (WO-180/WO-181): flattens the wire-shaped `governed[]`/`governed_warnings[]` arrays back
 * into the `Map`/array shapes `detectDrift` expects, and turns each reported commit into a `CommitInfo`.
 * Never touches Postgres or the network — every caller supplies `docs`/`baseline` separately (already
 * fetched, read-only state), which is exactly what makes this trivially unit-testable in isolation
 * (SDD-010 "Tests": "adaptador de drift").
 */
import type { Baseline, CodeRefState, CommitInfo, DriftInput, LifecycleContext, ParsedDoc } from '@prdm/core';
import type { CodeReportRequest } from '@prdm/contracts';

export function codeReportToDriftInput(report: CodeReportRequest, docs: ParsedDoc[], baseline: Baseline, lifecycle?: LifecycleContext): DriftInput {
  const governed = new Map<string, CodeRefState[]>();
  for (const entry of report.governed) governed.set(entry.blueprintId, entry.refs);

  // `parents` (WO-231) también viaja al grafo (SDD-095 D1): el conteo de padres clasifica el hueco de commits (merge).
  const commits: CommitInfo[] = report.commits.map((commit) => ({
    sha: commit.sha,
    parents: commit.parents,
    author: commit.author,
    date: commit.date,
    subject: commit.subject,
    refs: commit.refs,
    files: commit.files,
  }));

  return {
    docs,
    governed,
    governWarnings: report.governed_warnings.map((warning) => ({ blueprintId: warning.blueprintId, message: warning.message })),
    baseline,
    commits,
    dirty: new Set(report.dirty),
    lifecycle,
  };
}
