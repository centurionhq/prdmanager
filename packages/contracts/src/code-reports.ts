/**
 * `POST /api/v1/projects/:graphProjectId/code-reports` request/response (SDD-010 "Sync de developers y
 * drift", WO-177/WO-180/WO-181): what `prdm sync`'s remote mode uploads after scanning its local
 * governance cache and git working tree. Every array is capped (see the `MAX_*` constants) purely as an
 * operational safety limit against an oversized/adversarial body — SDD-010 itself never pins an exact
 * number for any of these, so the caps below are a judgment call, not a spec requirement; the request
 * as a whole is additionally bounded by the route's own `bodyLimit` (see
 * `MAX_CODE_REPORT_BODY_BYTES`, applied server-side).
 *
 * `governed[]` mirrors `@prdm/core`'s `DriftInput.governed: Map<blueprintId, CodeRefState[]>` shape
 * flattened for JSON transport (an object can't have array/Map identity over the wire); the server's
 * `codeReportToDriftInput` adapter (WO-181) turns this back into a `Map`. `commits[].author` is a
 * display name only — the CLI never reports a commit author's email (SDD-010: "autor solo nombre").
 */
import { z } from 'zod';

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
const DOC_ID_PATTERN = /^(MRD|PRD|FR|SDD|ADR|WO|ART|FB)-\d{3,9}$/;
const HASH64_PATTERN = /^[0-9a-f]{64}$/;

/** Route-level `bodyLimit` for `POST .../code-reports` (applied in `packages/server`, not by zod
 * itself) — a judgment call, generous enough for any realistic report, well short of exhausting a
 * request handler's memory. */
export const MAX_CODE_REPORT_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_GOVERNED_BLUEPRINTS = 5000;
export const MAX_REFS_PER_BLUEPRINT = 2000;
export const MAX_GOVERNED_WARNINGS = 2000;
export const MAX_COMMITS_PER_REPORT = 2000;
export const MAX_DIRTY_PATHS = 5000;

export const codeRefStateSchema = z.strictObject({
  key: z.string().min(1).max(500),
  path: z.string().min(1).max(1000),
  symbol: z.string().max(500).nullable(),
  hash: z.string().regex(HASH64_PATTERN).nullable(),
});
export type CodeRefStateDto = z.infer<typeof codeRefStateSchema>;

export const governedEntrySchema = z.strictObject({
  blueprintId: z.string().regex(DOC_ID_PATTERN),
  refs: z.array(codeRefStateSchema).max(MAX_REFS_PER_BLUEPRINT),
});
export type GovernedEntryDto = z.infer<typeof governedEntrySchema>;

export const governedWarningSchema = z.strictObject({
  blueprintId: z.string().regex(DOC_ID_PATTERN),
  message: z.string().min(1).max(2000),
});

export const reportedCommitSchema = z.strictObject({
  sha: z.string().regex(SHA_PATTERN),
  /** Display name only, never an email address (SDD-010: "autor solo nombre"). */
  author: z.string().min(1).max(200),
  date: z.iso.datetime(),
  subject: z.string().max(2000),
  refs: z.array(z.string().max(200)).max(50),
  files: z.array(z.string().max(1000)).max(5000),
});
export type ReportedCommitDto = z.infer<typeof reportedCommitSchema>;

export const codeReportRequestSchema = z.strictObject({
  schema_version: z.literal(1),
  client: z.strictObject({
    prdm_version: z.string().min(1).max(50),
    hash_algo_version: z.number().int().positive(),
  }),
  branch: z.string().min(1).max(255),
  head_sha: z.string().regex(SHA_PATTERN),
  /** Decimal-string `graph_version` this report's `governed[]`/impacts_hashes were computed against
   * (see `governanceResponseSchema.graphVersion`'s own doc comment on why bigint travels as a string). */
  docs_graph_version: z.string().regex(/^\d+$/),
  impacts_hashes: z.record(z.string().regex(DOC_ID_PATTERN), z.string().regex(HASH64_PATTERN)),
  governed: z.array(governedEntrySchema).max(MAX_GOVERNED_BLUEPRINTS),
  governed_warnings: z.array(governedWarningSchema).max(MAX_GOVERNED_WARNINGS),
  commits: z.array(reportedCommitSchema).max(MAX_COMMITS_PER_REPORT),
  dirty: z.array(z.string().min(1).max(1000)).max(MAX_DIRTY_PATHS),
});
export type CodeReportRequest = z.infer<typeof codeReportRequestSchema>;

export const codeReportModeSchema = z.enum(['baseline', 'preview']);
export type CodeReportMode = z.infer<typeof codeReportModeSchema>;

export const codeReportIssueSchema = z.strictObject({
  kind: z.string(),
  severity: z.enum(['error', 'warning']),
  nodeId: z.string(),
  target: z.string().optional(),
  message: z.string(),
});

export const codeReportResponseSchema = z.strictObject({
  mode: codeReportModeSchema,
  reportId: z.string(),
  headSha: z.string().regex(SHA_PATTERN),
  issues: z.array(codeReportIssueSchema),
  hasBlockingIssues: z.boolean(),
});
export type CodeReportResponse = z.infer<typeof codeReportResponseSchema>;
