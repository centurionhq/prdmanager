/**
 * `GET /api/v1/projects/:graphProjectId/governance` response (SDD-010 "MCP remoto", WO-177/WO-178):
 * what `prdm sync`'s remote mode caches locally under `.prdm/remote/docs/<ID>.md` — the server's
 * `settings` (same shape `projects.settings` already validates, `@prdm/contracts`' own
 * `projectSettingsSchema`) plus every currently-published document, keyed by `graph_version` for the
 * caller's `If-None-Match` (SDD-010: `If-None-Match: "<graph_version>"` -> `304` when unchanged).
 *
 * `graphVersion` travels as a decimal string (never a JSON number): `projects.graph_version` is a
 * Postgres `bigint`, which can exceed `Number.MAX_SAFE_INTEGER` in principle, so this mirrors the same
 * "bigint as string over the wire" convention used everywhere else bigint columns cross a contract
 * boundary in this codebase.
 *
 * Document count is capped (`MAX_GOVERNANCE_DOCUMENTS`) purely as an operational safety limit — SDD-010
 * itself does not pin an exact number here, so this is a judgment call, generous enough for any
 * realistic project's published document set.
 */
import { z } from 'zod';
import { projectSettingsSchema } from './project-settings.js';

// SDD-026 (BUG): a hand-duplicated copy of `packages/core/src/domain/schema.ts`'s `ID_PATTERN` (same
// "no cross-package dependency" convention as elsewhere) -- SDD-022/WO-433 added `BC` there but missed
// this copy, since this file wasn't in that SDD's own `impacts_paths`. Dormant until the first `BC`
// document was ever actually published (verifying PRD-011/SDD-024 live), which then broke `prdm sync
// --check` in CI with "invalid governance response".
const DOC_ID_PATTERN = /^(MRD|PRD|FR|BC|SDD|ADR|WO|ART|FB)-\d{3,9}$/;

export const MAX_GOVERNANCE_DOCUMENTS = 5000;
/** Operational cap on a single published document's rendered size (bytes, measured as UTF-16 code
 * units, close enough for a safety limit) — again a judgment call, not a number the SDD spells out. */
export const MAX_GOVERNANCE_DOCUMENT_BYTES = 1_000_000;

export const governanceDocumentSchema = z.strictObject({
  id: z.string().regex(DOC_ID_PATTERN, 'invalid document id (expected e.g. PRD-001)'),
  sourcePath: z.string().min(1).max(1000),
  content: z.string().max(MAX_GOVERNANCE_DOCUMENT_BYTES),
});
export type GovernanceDocumentDto = z.infer<typeof governanceDocumentSchema>;

export const governanceResponseSchema = z.strictObject({
  graphVersion: z.string().regex(/^\d+$/, 'graphVersion must be a decimal string'),
  settings: projectSettingsSchema,
  documents: z.array(governanceDocumentSchema).max(MAX_GOVERNANCE_DOCUMENTS),
});
export type GovernanceResponseDto = z.infer<typeof governanceResponseSchema>;
