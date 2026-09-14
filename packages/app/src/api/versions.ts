/**
 * `.../documents/:docId/versions*` (SDD-008 §"Versiones", WO-156/157/163).
 */
import type { DocumentVersionSummary } from '@prdm/contracts';
import type { LineDiffOp } from '@prdm/collab';
import { request } from './request.js';

function versionsBase(orgSlug: string, projectSlug: string, docId: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/documents/${encodeURIComponent(docId)}/versions`;
}

export function listDocumentVersions(orgSlug: string, projectSlug: string, docId: string): Promise<DocumentVersionSummary[]> {
  return request<{ versions: DocumentVersionSummary[] }>(versionsBase(orgSlug, projectSlug, docId)).then((r) => r.versions);
}

export function saveDocumentVersion(orgSlug: string, projectSlug: string, docId: string, label: string): Promise<DocumentVersionSummary> {
  return request<{ version: DocumentVersionSummary }>(versionsBase(orgSlug, projectSlug, docId), { method: 'POST', body: { label } }).then((r) => r.version);
}

export interface DocumentVersionDiff {
  from: DocumentVersionSummary;
  to: DocumentVersionSummary;
  diff: LineDiffOp[];
}

export function getDocumentVersionDiff(orgSlug: string, projectSlug: string, docId: string, versionNo: number, against: number): Promise<DocumentVersionDiff> {
  return request<DocumentVersionDiff>(`${versionsBase(orgSlug, projectSlug, docId)}/${versionNo}/diff?against=${against}`);
}

export function restoreDocumentVersion(orgSlug: string, projectSlug: string, docId: string, versionNo: number): Promise<DocumentVersionSummary> {
  return request<{ version: DocumentVersionSummary }>(`${versionsBase(orgSlug, projectSlug, docId)}/${versionNo}/restore`, { method: 'POST' }).then((r) => r.version);
}
