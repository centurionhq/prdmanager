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
  label: z.string().nullable(),
  reason: z.enum(['manual', 'review_request', 'published', 'agent_accept', 'restore', 'engine_write', 'import']),
  renderedMarkdown: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  contentHash: z.string(),
  contributors: z.array(z.string()),
  createdAt: z.string(),
});
export type DocumentVersionSummary = z.infer<typeof documentVersionSummarySchema>;

/** WO-225 (performance review, MEDIUM): the `GET .../versions` *list* endpoint's own shape — everything
 * {@link documentVersionSummarySchema} has except `renderedMarkdown`, which no list consumer (e.g.
 * `VersionsPanel`) reads and which the list query itself never selects from the database in the first
 * place (a full rendered-markdown blob per row, over-fetched for every version just to list them). The
 * diff/restore endpoints, which do need it, still return the full {@link DocumentVersionSummary}. */
export const documentVersionListItemSchema = documentVersionSummarySchema.omit({ renderedMarkdown: true });
export type DocumentVersionListItem = z.infer<typeof documentVersionListItemSchema>;

/** `POST .../documents/:docId/versions` (SDD-008 §"Versiones", WO-156): a manual save-with-label — the
 * only field a caller supplies, everything else (content, contributors, hash) is captured server-side
 * from the live collaborative document. */
export const createDocumentVersionInputSchema = z.object({
  label: z.string().min(1).max(200),
});
export type CreateDocumentVersionInput = z.infer<typeof createDocumentVersionInputSchema>;

/** Mirrors `@prdm/core`'s `ValidationIssue` by hand (same SDD-006 §Arquitectura reasoning as
 * `DOCUMENT_KINDS` above: `packages/contracts` never depends on `@prdm/core`). */
export const validationIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  field: z.string().optional(),
  message: z.string(),
});
export type ValidationIssueSummary = z.infer<typeof validationIssueSchema>;

export const documentDetailSchema = documentSummarySchema.extend({
  latestVersion: documentVersionSummarySchema.nullable(),
  publishedVersionId: z.string().nullable(),
  publishedRaw: z.string().nullable(),
  publishedContentHash: z.string().nullable(),
  /** SDD-008 §"Validación en vivo": the result of the last `validateDocument` run in `edit` mode after a
   * collab store, `null` for a document that has never gone through a live-collab store (e.g. still just
   * a freshly created draft, or a `generated`-origin document with no working copy at all). */
  lastValidation: z.array(validationIssueSchema).nullable(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;

export const publishDocumentInputSchema = z.object({
  versionId: z.string().min(1),
  contentHash: z.string().min(1),
});
export type PublishDocumentInput = z.infer<typeof publishDocumentInputSchema>;
