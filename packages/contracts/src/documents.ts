/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/documents/*` validation and response shapes
 * (SDD-007 "Documentos y flujo", WO-136): the human-authored document lifecycle
 * `draft -> in_review -> published -> archived`.
 *
 * `DOCUMENT_KINDS`/`documentKindSchema` mirror `@prdm/core`'s `DOC_KINDS` by hand (same reasoning as
 * `project-settings.ts`'s own hand-synced copy: `packages/contracts` has no dependency on `@prdm/core`,
 * SDD-006 §Arquitectura's one-way dependency graph). `WO` is excluded from what a human can create
 * from a template (`TEMPLATE_DOCUMENT_KINDS`) — a work order is only ever created by
 * `generateWorkOrders` (SDD-002 "Ciclo de vida"), never authored directly.
 */
import { z } from 'zod';

export const DOCUMENT_KINDS = ['MRD', 'PRD', 'FR', 'SDD', 'ADR', 'WO', 'ART', 'FB'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const TEMPLATE_DOCUMENT_KINDS = DOCUMENT_KINDS.filter((k): k is Exclude<DocumentKind, 'WO'> => k !== 'WO');

export const DOCUMENT_WORKFLOW_STATES = ['draft', 'in_review', 'published', 'archived'] as const;
export type DocumentWorkflowState = (typeof DOCUMENT_WORKFLOW_STATES)[number];

export const documentKindSchema = z.enum(DOCUMENT_KINDS);
export const templateDocumentKindSchema = z.enum(TEMPLATE_DOCUMENT_KINDS as unknown as [string, ...string[]]);
export const documentWorkflowStateSchema = z.enum(DOCUMENT_WORKFLOW_STATES);

export const documentTitleSchema = z.string().min(1).max(300);

export const createDocumentInputSchema = z.object({
  kind: templateDocumentKindSchema,
  title: documentTitleSchema,
});
export type CreateDocumentInput = z.infer<typeof createDocumentInputSchema>;

export const listDocumentsQuerySchema = z.object({
  kind: documentKindSchema.optional(),
  workflowState: documentWorkflowStateSchema.optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

export const documentSummarySchema = z.object({
  id: z.string(),
  docId: z.string(),
  kind: documentKindSchema,
  title: z.string(),
  origin: z.enum(['collab', 'generated', 'import']),
  workflowState: documentWorkflowStateSchema,
  sourcePath: z.string(),
  updatedAt: z.string(),
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const documentVersionSummarySchema = z.object({
  id: z.string(),
  versionNo: z.number().int().positive(),
  reason: z.enum(['manual', 'review_request', 'published', 'agent_accept', 'restore', 'engine_write', 'import']),
  renderedMarkdown: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  contentHash: z.string(),
  createdAt: z.string(),
});
export type DocumentVersionSummary = z.infer<typeof documentVersionSummarySchema>;

export const documentDetailSchema = documentSummarySchema.extend({
  latestVersion: documentVersionSummarySchema.nullable(),
  publishedVersionId: z.string().nullable(),
  publishedRaw: z.string().nullable(),
  publishedContentHash: z.string().nullable(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
