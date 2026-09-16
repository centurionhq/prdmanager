/**
 * `project_code_refs` row DTO (SDD-012 "Centurion Factory conectado al backend SaaS", WO-326/WO-331):
 * one governed code reference persisted from a baseline `code-reports` ingestion
 * (`packages/db/src/schema/documents.ts`'s sibling `project_code_refs` table), read back by
 * `PgProjectEngine.buildDriftInput` (WO-334) and exposed read-only to the dashboard.
 */
import { z } from 'zod';

const HASH64_PATTERN = /^[0-9a-f]{64}$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

export const codeRefDtoSchema = z.object({
  projectId: z.string(),
  orgId: z.string(),
  blueprintId: z.string(),
  refKey: z.string().min(1),
  path: z.string().min(1),
  symbol: z.string().nullable(),
  hash: z.string().regex(HASH64_PATTERN).nullable(),
  hashAlgoVersion: z.number().int().positive(),
  reportId: z.string(),
  headSha: z.string().regex(SHA_PATTERN),
  updatedAt: z.string(),
});
export type CodeRefDto = z.infer<typeof codeRefDtoSchema>;

/** Same reason vocabulary as `@prdm/core`'s `GovernedReason` (hand-synced, `packages/contracts` has no
 * dependency on `@prdm/core`). */
export const CODE_REF_SYNC_REASONS = ['unchanged', 'new', 'resolved_by_commit', 'code_changed', 'missing', 'blueprint_changed', 'feature_changed'] as const;

export const codeRefSyncVerdictSchema = z.object({
  status: z.enum(['synced', 'out_of_sync']),
  reason: z.enum(CODE_REF_SYNC_REASONS),
});
export type CodeRefSyncVerdictDto = z.infer<typeof codeRefSyncVerdictSchema>;
