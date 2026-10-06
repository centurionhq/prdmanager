/**
 * `RemoteDocumentsPort` (SDD-020 "Autoria remota de documentos por MCP", WO-421): the narrow, portable
 * surface `tools-remote-authoring.ts`'s `create_document`/`update_document`/`publish_document` tools are
 * built against. Deliberately made only of primitive/plain-object types here (never a `@prdm/db` record
 * type) so this file has no dependency on `packages/db` at all (SDD-006 §Arquitectura: "Dependencias en
 * un solo sentido" -- `packages/mcp` must never depend on `packages/db`). The concrete implementation
 * (`packages/server/src/documents/remote-documents-port.ts`) maps its own richer `@prdm/db` record types
 * down onto these DTOs; TypeScript's structural typing accepts that without either side importing the
 * other's types.
 */
import type { DocKind, DraftKind } from '@prdm/core';

export type RemoteDocumentWorkflowState = 'draft' | 'in_review' | 'published' | 'archived';

export interface RemoteDocumentSummary {
  docId: string;
  /** `DocKind` (not `DraftKind`): `list()` also returns the published Work Orders living in `documents`. */
  kind: DocKind;
  title: string;
  workflowState: RemoteDocumentWorkflowState;
  sourcePath: string;
}

export interface RemoteDocumentVersionSummary {
  id: string;
  versionNo: number;
  contentHash: string;
}

export interface RemoteDocumentWithVersion {
  document: RemoteDocumentSummary;
  latestVersion: RemoteDocumentVersionSummary | null;
}

export interface RemoteDocumentListFilter {
  kind?: DocKind;
  workflowState?: RemoteDocumentWorkflowState;
}

export interface RemoteDocumentDetailVersion {
  id: string;
  versionNo: number;
  contentHash: string;
  renderedMarkdown: string;
  frontmatter: Record<string, unknown>;
}

export interface RemoteDocumentDetail {
  document: RemoteDocumentSummary;
  latestVersion: RemoteDocumentDetailVersion | null;
}

export interface RemoteWorkOrderGenerationResult {
  generated: boolean;
  created: number;
  error?: string;
}

export interface RemotePublishResult {
  document: RemoteDocumentSummary;
  workOrders?: RemoteWorkOrderGenerationResult;
}

export interface RemoteSaveDraftVersionInput {
  fields?: Record<string, unknown>;
  body?: string;
  title?: string;
  createdBy: string;
}

export interface RemotePublishInput {
  expectedVersionId: string;
  expectedContentHash: string;
  publishedBy: string;
}

export interface RemoteImpactsPathsDrift {
  blueprintId: string;
  currentPatterns: readonly string[];
  suggestedAdditions: readonly string[];
  basedOnCommits: readonly string[];
}

export interface RemoteDocumentsPort {
  createAndSubmit(kind: DraftKind, title: string, createdBy: string): Promise<RemoteDocumentWithVersion>;
  /** Read side of SDD-067 D1/D5: the server is the source of truth for unpublished documents, so this lists
   * `draft`/`in_review` too. View permission and project isolation belong to the tenant scope that built
   * this port, not to the port itself. */
  list(filter?: RemoteDocumentListFilter): Promise<RemoteDocumentSummary[]>;
  /** `null` for both "wrong project" and "doesn't exist" (same 404 mapping as the REST route). */
  get(docId: string): Promise<RemoteDocumentDetail | null>;
  findByDocId(docId: string): Promise<RemoteDocumentWithVersion | null>;
  saveDraftVersion(docId: string, input: RemoteSaveDraftVersionInput): Promise<RemoteDocumentWithVersion>;
  publish(docId: string, input: RemotePublishInput): Promise<RemotePublishResult>;
  /** `null` when `blueprintId` doesn't exist or isn't a Blueprint (SDD-021, WO-431) -- read-only, exposed
   * over MCP unlike `saveDraftVersion`/`publish`'s write counterpart (`sync_impacts_paths` stays
   * REST/dashboard-only, per this project's own trust-tier precedent for governance-metadata writes). */
  getImpactsPathsDrift(blueprintId: string): Promise<RemoteImpactsPathsDrift | null>;
}
