/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/documents/*` (SDD-007 "Documentos y flujo",
 * WO-141): list/create/get and the workflow actions (request-review, publish, archive,
 * generate-work-orders) every document detail screen needs.
 */
import type {
  DocumentDetail,
  DocumentKind,
  DocumentSummary,
  DocumentWorkflowState,
  PublishDocumentInput,
} from '@prdm/contracts';
import type { ClosureReadiness } from '@prdm/core';
import type { BlameResult } from '@prdm/collab';
import { request } from './request.js';
import { buildQuery } from './build-query.js';

function documentsBase(orgSlug: string, projectSlug: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/documents`;
}

function documentBase(orgSlug: string, projectSlug: string, docId: string): string {
  return `${documentsBase(orgSlug, projectSlug)}/${encodeURIComponent(docId)}`;
}

export function listDocuments(
  orgSlug: string,
  projectSlug: string,
  filter: { kind?: DocumentKind; workflowState?: DocumentWorkflowState } = {},
): Promise<DocumentSummary[]> {
  const query = buildQuery({ kind: filter.kind, workflowState: filter.workflowState });
  return request<{ documents: DocumentSummary[] }>(`${documentsBase(orgSlug, projectSlug)}${query}`).then((r) => r.documents);
}

export function createDocument(orgSlug: string, projectSlug: string, input: { kind: DocumentKind; title: string }): Promise<DocumentDetail> {
  return request<{ document: DocumentDetail }>(documentsBase(orgSlug, projectSlug), { method: 'POST', body: input }).then((r) => r.document);
}

export function getDocument(orgSlug: string, projectSlug: string, docId: string): Promise<DocumentDetail> {
  return request<{ document: DocumentDetail }>(documentBase(orgSlug, projectSlug, docId)).then((r) => r.document);
}

export function requestDocumentReview(orgSlug: string, projectSlug: string, docId: string): Promise<DocumentSummary> {
  return request<{ document: DocumentSummary }>(`${documentBase(orgSlug, projectSlug, docId)}/request-review`, { method: 'POST' }).then((r) => r.document);
}

export function archiveDocument(orgSlug: string, projectSlug: string, docId: string): Promise<DocumentSummary> {
  return request<{ document: DocumentSummary }>(`${documentBase(orgSlug, projectSlug, docId)}/archive`, { method: 'POST' }).then((r) => r.document);
}

export interface PublishDocumentResult {
  document: DocumentDetail;
  workOrders?: { generated: boolean; created: number; error?: string };
}

export function publishDocument(orgSlug: string, projectSlug: string, docId: string, input: PublishDocumentInput): Promise<PublishDocumentResult> {
  return request<PublishDocumentResult>(`${documentBase(orgSlug, projectSlug, docId)}/publish`, { method: 'POST', body: input });
}

export function generateWorkOrders(orgSlug: string, projectSlug: string, docId: string): Promise<{ generated: boolean; created: number; error?: string }> {
  return request<{ workOrders: { generated: boolean; created: number; error?: string } }>(`${documentBase(orgSlug, projectSlug, docId)}/generate-work-orders`, {
    method: 'POST',
  }).then((r) => r.workOrders);
}

/** `GET .../closure-readiness` (WO-143): read-only, never mutates. */
export function getClosureReadiness(orgSlug: string, projectSlug: string, docId: string): Promise<ClosureReadiness> {
  return request<{ readiness: ClosureReadiness }>(`${documentBase(orgSlug, projectSlug, docId)}/closure-readiness`).then((r) => r.readiness);
}

export interface CloseFeatureResult {
  featureId: string;
  closedAt: string;
  closedBy: string;
}

/** `POST .../close` (WO-143): admin-only server-side. The status flip (WO-250) is written straight to
 * `published_raw` (and, if the feature's editor is open live, its `Y.Doc` too) before this resolves —
 * visible everywhere immediately, never a queued patch waiting on someone opening the editor. */
export function closeFeature(orgSlug: string, projectSlug: string, docId: string): Promise<{ result: CloseFeatureResult }> {
  return request(`${documentBase(orgSlug, projectSlug, docId)}/close`, { method: 'POST' });
}

/** `GET .../blame` (SDD-008 §"Autoría por línea no falsificable", WO-154/161): viewer-or-above, same as
 * any other document read. */
export function getDocumentBlame(orgSlug: string, projectSlug: string, docId: string): Promise<BlameResult> {
  return request<BlameResult>(`${documentBase(orgSlug, projectSlug, docId)}/blame`);
}
