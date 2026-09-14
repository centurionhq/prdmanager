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
import { request } from './request.js';

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
  const query = new URLSearchParams();
  if (filter.kind) query.set('kind', filter.kind);
  if (filter.workflowState) query.set('workflowState', filter.workflowState);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return request<{ documents: DocumentSummary[] }>(`${documentsBase(orgSlug, projectSlug)}${suffix}`).then((r) => r.documents);
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
