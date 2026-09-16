/**
 * `codeReportRequestSchema`/`codeReportResponseSchema` (SDD-010 "Sync de developers y drift",
 * WO-177/WO-180/WO-181).
 */
import { describe, expect, test } from 'vitest';
import { codeReportRequestSchema, codeReportResponseSchema, MAX_COMMITS_PER_REPORT, MAX_REFS_PER_COMMIT, reportedCommitSchema } from '../../src/code-reports.js';

const validReport = {
  schema_version: 1 as const,
  client: { prdm_version: '0.2.0', hash_algo_version: 1 },
  branch: 'main',
  head_sha: 'a'.repeat(40),
  docs_graph_version: '3',
  impacts_hashes: { 'SDD-010': 'a'.repeat(64) },
  governed: [{ blueprintId: 'SDD-010', refs: [{ key: 'k', path: 'x.ts', symbol: null, hash: null }] }],
  governed_warnings: [],
  commits: [{ sha: 'b'.repeat(40), parents: ['c'.repeat(40)], author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'feat: x', refs: ['WO-177'], files: ['x.ts'] }],
  dirty: [],
};

describe('codeReportRequestSchema', () => {
  test('accepts a well-formed report', () => {
    expect(codeReportRequestSchema.parse(validReport)).toEqual(validReport);
  });

  test('rejects a commit author that looks like an email (still just a string, but length-bounded)', () => {
    expect(() => reportedCommitSchema.parse({ ...validReport.commits[0], author: 'x'.repeat(500) })).toThrow();
  });

  test('rejects an unsupported schema_version', () => {
    expect(() => codeReportRequestSchema.parse({ ...validReport, schema_version: 2 })).toThrow();
  });

  test('rejects a non-hex head_sha', () => {
    expect(() => codeReportRequestSchema.parse({ ...validReport, head_sha: 'not-a-sha' })).toThrow();
  });

  test('rejects more commits than MAX_COMMITS_PER_REPORT', () => {
    const commits = Array.from({ length: MAX_COMMITS_PER_REPORT + 1 }, (_, i) => ({ ...validReport.commits[0], sha: i.toString(16).padStart(40, '0') }));
    expect(() => codeReportRequestSchema.parse({ ...validReport, commits })).toThrow();
  });

  test('WO-395 regression: accepts a commit citing MAX_REFS_PER_COMMIT Refs: ids (a real bulk reconciliation commit cited 58 against the old cap of 50) and rejects one more', () => {
    const refs = Array.from({ length: MAX_REFS_PER_COMMIT }, (_, i) => `WO-${i}`);
    expect(reportedCommitSchema.parse({ ...validReport.commits[0], refs }).refs).toHaveLength(MAX_REFS_PER_COMMIT);
    expect(() => reportedCommitSchema.parse({ ...validReport.commits[0], refs: [...refs, 'WO-extra'] })).toThrow();
  });

  test('rejects an unknown top-level key (strict object)', () => {
    expect(() => codeReportRequestSchema.parse({ ...validReport, extra: true })).toThrow();
  });

  test('accepts a commit with zero parents (history root) and rejects a non-hex parent sha', () => {
    expect(reportedCommitSchema.parse({ ...validReport.commits[0], parents: [] }).parents).toEqual([]);
    expect(() => reportedCommitSchema.parse({ ...validReport.commits[0], parents: ['not-a-sha'] })).toThrow();
  });
});

describe('codeReportResponseSchema', () => {
  test('accepts a baseline response', () => {
    const response = { mode: 'baseline' as const, reportId: 'r1', headSha: 'a'.repeat(40), issues: [], hasBlockingIssues: false };
    expect(codeReportResponseSchema.parse(response)).toEqual(response);
  });

  test('rejects an unknown mode', () => {
    expect(() => codeReportResponseSchema.parse({ mode: 'official', reportId: 'r1', headSha: 'a'.repeat(40), issues: [], hasBlockingIssues: false })).toThrow();
  });
});
