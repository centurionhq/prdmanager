/**
 * Commit DTO (SDD-012, WO-326): mirrors `@prdm/db`'s `commits` table
 * (`packages/db/src/schema/documents.ts`) fields a client actually needs — never `projectId`/`orgId`/
 * `reporterTokenId`, which stay server-side.
 */
import { z } from 'zod';

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

export const COMMIT_TRUST_LEVELS = ['baseline', 'preview', 'import'] as const;
export const commitTrustSchema = z.enum(COMMIT_TRUST_LEVELS);
export type CommitTrustDto = z.infer<typeof commitTrustSchema>;

export const commitDtoSchema = z.object({
  sha: z.string().regex(SHA_PATTERN),
  subject: z.string(),
  author: z.string(),
  date: z.string(),
  refs: z.array(z.string()),
  files: z.array(z.string()),
  trust: commitTrustSchema,
});
export type CommitDto = z.infer<typeof commitDtoSchema>;
