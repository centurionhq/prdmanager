/**
 * `.../documents/:docId/comments*` (SDD-008 §"Comentarios", WO-158/162).
 */
import type { CommentSummary, CommentThreadSummary, CreateCommentThreadInput, ReplyToCommentThreadInput } from '@prdm/contracts';
import { request } from './request.js';

function commentsBase(orgSlug: string, projectSlug: string, docId: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/documents/${encodeURIComponent(docId)}/comments`;
}

export function listCommentThreads(orgSlug: string, projectSlug: string, docId: string): Promise<CommentThreadSummary[]> {
  return request<{ threads: CommentThreadSummary[] }>(commentsBase(orgSlug, projectSlug, docId)).then((r) => r.threads);
}

export function createCommentThread(orgSlug: string, projectSlug: string, docId: string, input: CreateCommentThreadInput): Promise<CommentThreadSummary> {
  return request<{ thread: CommentThreadSummary }>(commentsBase(orgSlug, projectSlug, docId), { method: 'POST', body: input }).then((r) => r.thread);
}

export function replyToCommentThread(orgSlug: string, projectSlug: string, docId: string, threadId: string, input: ReplyToCommentThreadInput): Promise<CommentSummary> {
  return request<{ comment: CommentSummary }>(`${commentsBase(orgSlug, projectSlug, docId)}/${encodeURIComponent(threadId)}/replies`, { method: 'POST', body: input }).then((r) => r.comment);
}

export function resolveCommentThread(orgSlug: string, projectSlug: string, docId: string, threadId: string): Promise<CommentThreadSummary> {
  return request<{ thread: CommentThreadSummary }>(`${commentsBase(orgSlug, projectSlug, docId)}/${encodeURIComponent(threadId)}/resolve`, { method: 'POST' }).then((r) => r.thread);
}

export function reopenCommentThread(orgSlug: string, projectSlug: string, docId: string, threadId: string): Promise<CommentThreadSummary> {
  return request<{ thread: CommentThreadSummary }>(`${commentsBase(orgSlug, projectSlug, docId)}/${encodeURIComponent(threadId)}/reopen`, { method: 'POST' }).then((r) => r.thread);
}

export function deleteComment(orgSlug: string, projectSlug: string, docId: string, threadId: string, commentId: string): Promise<CommentSummary> {
  return request<{ comment: CommentSummary }>(`${commentsBase(orgSlug, projectSlug, docId)}/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  }).then((r) => r.comment);
}
