/**
 * `POST /api/v1/projects/:graphProjectId/policy-docs` request/response (SDD-010 "Sync de developers y
 * drift": "check commits --range remoto pide en un solo request GET /policy-docs evaluado a la fecha
 * first_seen_at de cada sha", WO-183): a single batched request so evaluating a whole commit range's
 * `Refs:` policy never turns into one round trip per commit. `shas` is capped
 * (`MAX_POLICY_DOCS_SHAS`) — again an operational judgment call, not a number the SDD spells out —
 * generous enough for any single CI range check.
 */
import { z } from 'zod';
import { governanceDocumentSchema } from './governance.js';

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

export const MAX_POLICY_DOCS_SHAS = 500;

/** Route-level `bodyLimit` for `POST .../policy-docs` (applied in `packages/server`, not by zod itself),
 * for consistency with every other new route this phase (`code-reports`, `import` each declare one) —
 * an operational judgment call, not a number the SDD spells out. The request body is just `{ shas:
 * string[] }`, each entry a 7-40 hex-char sha (`SHA_PATTERN`): `MAX_POLICY_DOCS_SHAS` (500) full-length
 * shas plus JSON quoting/commas is well under 32 KiB — this leaves a generous margin above that without
 * copying another route's much larger limit (`MAX_IMPORT_BODY_BYTES`/`MAX_CODE_REPORT_BODY_BYTES`),
 * which this endpoint's tiny, fixed-shape payload never needs. */
export const MAX_POLICY_DOCS_BODY_BYTES = 32 * 1024;

export const policyDocsRequestSchema = z.strictObject({
  shas: z.array(z.string().regex(SHA_PATTERN)).min(1).max(MAX_POLICY_DOCS_SHAS),
});
export type PolicyDocsRequest = z.infer<typeof policyDocsRequestSchema>;

export const policyDocsResultSchema = z.strictObject({
  sha: z.string().regex(SHA_PATTERN),
  /** The instant policy was evaluated at for this sha: the commit's own recorded `first_seen_at`
   * (SDD-010, never the date `git log` reports, which a developer controls) when the server has seen
   * this sha before, otherwise "now". */
  evaluatedAt: z.iso.datetime(),
  documents: z.array(governanceDocumentSchema),
});
export type PolicyDocsResult = z.infer<typeof policyDocsResultSchema>;

export const policyDocsResponseSchema = z.strictObject({
  results: z.array(policyDocsResultSchema),
});
export type PolicyDocsResponse = z.infer<typeof policyDocsResponseSchema>;
