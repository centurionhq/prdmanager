/**
 * `.../documents/:docId/versions*` (SDD-008 §"Versiones", WO-156/157/163).
 */
import type { DocumentVersionListItem, DocumentVersionSummary } from '@prdm/contracts';
import type { LineDiffOp } from '@prdm/collab';
import { request } from './request.js';

function versionsBase(orgSlug: string, projectSlug: string, docId: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/documents/${encodeURIComponent(docId)}/versions`;
}

/** WO-225: paginated (`limit`/`offset`, matching the list endpoint's own querystring) — defaults to the
 * server's own first-page defaults when omitted. List items never include `renderedMarkdown` (unused by
 * every current list consumer); the diff endpoint below still returns it. */
export interface ListDocumentVersionsPage {
  versions: DocumentVersionListItem[];
  total: number;
  limit: number;
  offset: number;
}

export function listDocumentVersions(orgSlug: string, projectSlug: string, docId: string, page: { limit?: number; offset?: number } = {}): Promise<ListDocumentVersionsPage> {
  const query = new URLSearchParams();
  if (page.limit !== undefined) query.set('limit', String(page.limit));
  if (page.offset !== undefined) query.set('offset', String(page.offset));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return request<ListDocumentVersionsPage>(`${versionsBase(orgSlug, projectSlug, docId)}${suffix}`);
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
