/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/{feedback,inbox}` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-339): submit raw feedback text, list the triage inbox, and — for one
 * inbox item — fetch its linking candidates and act on them.
 */
import type { CandidateDto, InboxItemDto, SubmitFeedbackInput } from '@prdm/contracts';
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
}

export function listInbox(orgSlug: string, projectSlug: string, filters: InboxFilters = {}): Promise<InboxItemDto[]> {
  return request<{ items: InboxItemDto[] }>(
    `${projectBase(orgSlug, projectSlug)}/inbox${buildQuery({ status: filters.status })}`,
  ).then((r) => r.items);
}

export function getFeedbackCandidates(orgSlug: string, projectSlug: string, docId: string): Promise<CandidateDto[]> {
  return request<{ candidates: CandidateDto[] }>(
    `${projectBase(orgSlug, projectSlug)}/feedback/${encodeURIComponent(docId)}/candidates`,
  ).then((r) => r.candidates);
}

export interface TriageFeedbackInput {
  readonly linkTo: readonly string[];
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
