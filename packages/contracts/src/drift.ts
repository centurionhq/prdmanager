/**
 * `POST /api/app/organizations/:orgSlug/projects/:projectSlug/drift/acknowledge` validation (SDD-007
 * "Documentos y flujo", WO-140). `target` mirrors `@prdm/core`'s `acknowledge(input, target)` contract:
 * either a real document id or the literal `"all"`; the id pattern is hand-synced with `@prdm/core`'s
 * `ID_PATTERN` (same reasoning as `documents.ts`'s hand-synced `DOCUMENT_KINDS` — `packages/contracts`
 * has no dependency on `@prdm/core`).
 */
import { z } from 'zod';
import { stationSchema } from './lifecycle.js';
import { codeReportModeSchema } from './code-reports.js';

const ACK_TARGET_PATTERN = /^(all|(MRD|PRD|FR|SDD|ADR|WO|ART|FB)-\d{3,9})$/;
const HEX_ID_PATTERN = /^[0-9a-f]+$/;

export const driftAcknowledgeInputSchema = z.object({
  target: z.string().regex(ACK_TARGET_PATTERN, 'target must be "all" or a document id like WO-001'),
});
export type DriftAcknowledgeInput = z.infer<typeof driftAcknowledgeInputSchema>;

/**
 * `driftIssueDtoSchema` (SDD-012, WO-326): `@prdm/core`'s bare `DriftIssue` (`kind`/`severity`/`nodeId`/
 * `target`/`message`, hand-synced the same way `codeReportIssueSchema` already is) plus the feature/
 * blueprint/station attribution `@prdm/core`'s `attributeIssue` (WO-329) computes, so the Centurion
 * Factory line board can place an issue directly on a feature's lane without re-deriving attribution
 * client-side.
 */
export const driftIssueDtoSchema = z.object({
  kind: z.string(),
  severity: z.enum(['error', 'warning']),
  nodeId: z.string(),
  target: z.string().optional(),
  message: z.string(),
  id: z.string().regex(HEX_ID_PATTERN, 'id must be a hex string'),
  featureIds: z.array(z.string()),
  blueprintId: z.string().nullable(),
  station: stationSchema.nullable(),
  detectedAt: z.string(),
});
export type DriftIssueDto = z.infer<typeof driftIssueDtoSchema>;

/** `GET .../drift/reports/:id` (SDD-012, WO-326): `DriftReportSummaryDto`'s own fields (mirrored by
 * hand here, same convention as `code-reports.ts`'s own outbound-only interfaces) plus that report's
 * full issue list. */
export const driftReportDetailSchema = z.object({
  id: z.string(),
  mode: codeReportModeSchema,
  headSha: z.string(),
  branch: z.string().nullable(),
  tokenName: z.string(),
  issueCount: z.number().int().min(0),
  hasBlockingIssues: z.boolean(),
  createdAt: z.string(),
  issues: z.array(driftIssueDtoSchema),
});
export type DriftReportDetailDto = z.infer<typeof driftReportDetailSchema>;
