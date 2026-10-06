/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/{feedback,inbox}` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-339): submit raw feedback text, list the triage inbox, and — for one
 * inbox item — fetch its linking candidates and act on them.
 */
import type { CandidateDto, InboxResponseDto, SubmitFeedbackInput } from '@prdm/contracts';
import { buildQuery } from './build-query.js';
import { request } from './request.js';

function projectBase(orgSlug: string, projectSlug: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}`;
}

export interface SubmitFeedbackResult {
  readonly id: string;
  readonly linkedTo: readonly string[];
  readonly candidates: readonly CandidateDto[];
}

export function submitFeedback(orgSlug: string, projectSlug: string, input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  return request<SubmitFeedbackResult>(`${projectBase(orgSlug, projectSlug)}/feedback`, { method: 'POST', body: input });
}

export interface InboxFilters {
  readonly status?: string;
  readonly kind?: 'FB' | 'ART';
  readonly source?: string;
  readonly q?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * `GET /inbox` (SDD-065 D3): the endpoint now pages/filters server-side and answers with the
 * `{items,total}` envelope, so callers get the real count behind the current page. The app screen
 * fetches with `limit` (bounded by `MAX_INBOX_LIMIT`) and paginates in the client, because it sorts by
 * título/id — a sort the endpoint does not expose.
 */
export function listInbox(orgSlug: string, projectSlug: string, filters: InboxFilters = {}): Promise<InboxResponseDto> {
  return request<InboxResponseDto>(
    `${projectBase(orgSlug, projectSlug)}/inbox${buildQuery({
      status: filters.status,
      kind: filters.kind,
      source: filters.source,
      q: filters.q,
      limit: filters.limit === undefined ? undefined : String(filters.limit),
      offset: filters.offset === undefined ? undefined : String(filters.offset),
    })}`,
  );
}

export function getFeedbackCandidates(orgSlug: string, projectSlug: string, docId: string): Promise<CandidateDto[]> {
  return request<{ candidates: CandidateDto[] }>(
    `${projectBase(orgSlug, projectSlug)}/feedback/${encodeURIComponent(docId)}/candidates`,
  ).then((r) => r.candidates);
}

export interface TriageFeedbackInput {
  /** Matches the server's `triageInputSchema` field name exactly (`project-feedback.ts`) — the request
   * body is forwarded as-is, so a mismatched key here silently drops the link entirely (the server's zod
   * schema treats an unrecognized key as absent rather than a validation error) instead of failing loudly. */
  readonly informs: readonly string[];
}

export interface TriageFeedbackResult {
  readonly linkedTo: readonly string[];
}

export function triageFeedback(
  orgSlug: string,
  projectSlug: string,
  docId: string,
  input: TriageFeedbackInput,
): Promise<TriageFeedbackResult> {
  return request<TriageFeedbackResult>(`${projectBase(orgSlug, projectSlug)}/feedback/${encodeURIComponent(docId)}/triage`, {
    method: 'POST',
    body: input,
  });
}
