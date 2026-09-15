/**
 * `POST /api/app/organizations/:orgSlug/projects/:projectSlug/drift/acknowledge` validation (SDD-007
 * "Documentos y flujo", WO-140). `target` mirrors `@prdm/core`'s `acknowledge(input, target)` contract:
 * either a real document id or the literal `"all"`; the id pattern is hand-synced with `@prdm/core`'s
 * `ID_PATTERN` (same reasoning as `documents.ts`'s hand-synced `DOCUMENT_KINDS` — `packages/contracts`
 * has no dependency on `@prdm/core`).
 */
import { z } from 'zod';

const ACK_TARGET_PATTERN = /^(all|(MRD|PRD|FR|SDD|ADR|WO|ART|FB)-\d{3,9})$/;

export const driftAcknowledgeInputSchema = z.object({
  target: z.string().regex(ACK_TARGET_PATTERN, 'target must be "all" or a document id like WO-001'),
});
export type DriftAcknowledgeInput = z.infer<typeof driftAcknowledgeInputSchema>;
