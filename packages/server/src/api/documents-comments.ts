/**
 * `.../documents/:docId/comments*` (SDD-008 §"Comentarios", WO-158): threads anchored on the live body
 * via `Y.RelativePosition`, `quoted_text` always recomputed server-side from the current `Y.Doc` (never
 * trusted from the stored snapshot alone — see `@prdm/db`'s `doc-comments.ts` module doc comment), and a
 * stateless broadcast on every new comment/resolve so connected clients (WO-162's panel) refresh.
 *
 * Permissions follow SDD-008's own prose ("responder, resolver, reabrir, borrar el propio ... commenter o
 * superior") rather than `edit_document`: create/reply/resolve/reopen all gate on `can(subject,
 * 'comment')` (commenter+); deleting someone else's requires `delete_others_comments` (admin-only, per
 * `@prdm/contracts`'s permission matrix) — deleting your own only requires still being a commenter.
 *
 * Security review #2 (HIGH, WO-219): create-thread and reply are additionally volume rate-limited per
 * user and per document (`../rate-limit/comment-rate-limits.js`) — the existing ≤ 10 KB body-size cap
 * bounds a single comment's size, not how many a caller can fire per minute. Resolve/reopen share the
 * same limiter (one more `check` call each, same config) since a resolve/reopen storm is the same class
 * of volume abuse even though its blast radius is smaller than an unbounded flood of new comments.
 */
import { can, createCommentThreadInputSchema, replyToCommentThreadInputSchema, type CommentSummary, type CommentThreadSummary } from '@prdm/contracts';
import { createTenantDb, type DocCommentRecord, type DocCommentThreadRecord } from '@prdm/db';
import { resolveCommentAnchor, createCommentAnchor } from '@prdm/collab';
import type { Hocuspocus } from '@hocuspocus/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { formatDocumentName } from '../collab/document-name.js';
import { reconstructLiveYDoc } from '../collab/reconstruct-ydoc.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from '../errors.js';
import type { CommentRateLimiter } from '../rate-limit/comment-rate-limits.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject } from './projects.js';

export interface RegisterDocumentCommentRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  hocuspocus: Hocuspocus;
  rateLimiter: CommentRateLimiter;
}

interface DocumentRouteParams {
  orgSlug: string;
  projectSlug: string;
  docId: string;
}

interface ThreadRouteParams extends DocumentRouteParams {
  threadId: string;
}

interface CommentRouteParams extends ThreadRouteParams {
  commentId: string;
}

const COMMENT_EVENT_MESSAGE = 'comment:updated';

function toCommentSummary(comment: DocCommentRecord): CommentSummary {
  return {
    id: comment.id,
    authorId: comment.authorId,
    body: comment.deletedAt ? null : comment.body,
    createdAt: comment.createdAt.toISOString(),
    editedAt: comment.editedAt?.toISOString() ?? null,
    deletedAt: comment.deletedAt?.toISOString() ?? null,
  };
}

function toThreadSummary(thread: DocCommentThreadRecord, comments: DocCommentRecord[], quotedText: string | null): CommentThreadSummary {
  return {
    id: thread.id,
    documentId: thread.documentId,
    quotedText,
    anchorStart: thread.anchorStart.toString('base64'),
    anchorEnd: thread.anchorEnd.toString('base64'),
    status: thread.status,
    createdBy: thread.createdBy,
    resolvedBy: thread.resolvedBy,
    resolvedAt: thread.resolvedAt?.toISOString() ?? null,
    createdAt: thread.createdAt.toISOString(),
    comments: comments.map(toCommentSummary),
  };
}

export function registerDocumentCommentRoutes(app: FastifyInstance, opts: RegisterDocumentCommentRoutesOptions): void {
  const { auth, pool, env, hocuspocus, rateLimiter } = opts;

  function notifyDocument(projectId: string, documentId: string): void {
    hocuspocus.documents.get(formatDocumentName(projectId, documentId))?.broadcastStateless(JSON.stringify({ type: COMMENT_EVENT_MESSAGE }));
  }

  /** Throws `RateLimitedError` (429) once `userId` or `documentId` exceeds `../rate-limit/comment-rate-
   * limits.js`'s volume caps — call after permission checks (a rejected/forbidden caller shouldn't cost
   * the legitimate rate budget) but before the row is actually written. */
  async function enforceCommentRateLimit(req: FastifyRequest, reply: FastifyReply, userId: string, documentId: string): Promise<void> {
    const limit = await rateLimiter.check(req, { userId, documentId });
    if (!limit.allowed) {
      reply.header('retry-after', String(limit.retryAfterSeconds));
      throw new RateLimitedError();
    }
  }

  app.get<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      const threads = await createTenantDb(pool).forOrg(org.id).docComments.listThreads(existing.document.id);
      const { ydoc } = await reconstructLiveYDoc(pool, org.id, existing.document.id);

      const summaries = threads.map(({ thread, comments }) => {
        const { quotedText } = resolveCommentAnchor(ydoc, { start: thread.anchorStart, end: thread.anchorEnd });
        return toThreadSummary(thread, comments, quotedText);
      });

      return { threads: summaries };
    },
  );

  app.post<{ Params: DocumentRouteParams; Body: unknown }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'comment')) throw new ForbiddenError();

      const parsed = createCommentThreadInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');
      if (parsed.data.endIndex <= parsed.data.startIndex) throw new ValidationError('endIndex must be greater than startIndex');

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      await enforceCommentRateLimit(req, reply, session.user.id, existing.document.id);

      const { ydoc } = await reconstructLiveYDoc(pool, org.id, existing.document.id);
      const bodyLength = ydoc.getText('body').length;
      if (parsed.data.endIndex > bodyLength) throw new ValidationError('endIndex is beyond the end of the document body');

      const anchor = createCommentAnchor(ydoc, parsed.data.startIndex, parsed.data.endIndex);
      const { quotedText } = resolveCommentAnchor(ydoc, anchor);

      const { thread, comments } = await createTenantDb(pool)
        .forOrg(org.id)
        .docComments.createThread({
          documentId: existing.document.id,
          anchorStart: Buffer.from(anchor.start),
          anchorEnd: Buffer.from(anchor.end),
          quotedText: quotedText ?? '',
          createdBy: session.user.id,
          body: parsed.data.body,
        });

      notifyDocument(project.id, existing.document.id);
      return { thread: toThreadSummary(thread, comments, quotedText) };
    },
  );

  app.post<{ Params: ThreadRouteParams; Body: unknown }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments/:threadId/replies',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'comment')) throw new ForbiddenError();

      const parsed = replyToCommentThreadInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();
      const repo = createTenantDb(pool).forOrg(org.id).docComments;
      const thread = await repo.findThread(req.params.threadId);
      if (!thread || thread.documentId !== existing.document.id) throw new NotFoundError();

      await enforceCommentRateLimit(req, reply, session.user.id, existing.document.id);

      const comment = await repo.addReply(thread.id, session.user.id, parsed.data.body);
      notifyDocument(project.id, existing.document.id);
      return { comment: toCommentSummary(comment) };
    },
  );

  app.post<{ Params: ThreadRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments/:threadId/resolve',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'comment')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();
      const repo = createTenantDb(pool).forOrg(org.id).docComments;
      const thread = await repo.findThread(req.params.threadId);
      if (!thread || thread.documentId !== existing.document.id) throw new NotFoundError();

      await enforceCommentRateLimit(req, reply, session.user.id, existing.document.id);

      const resolved = await repo.resolveThread(thread.id, session.user.id);
      if (!resolved) throw new NotFoundError();
      const [comments, { ydoc }] = await Promise.all([repo.listCommentsForThread(thread.id), reconstructLiveYDoc(pool, org.id, existing.document.id)]);
      const { quotedText } = resolveCommentAnchor(ydoc, { start: resolved.anchorStart, end: resolved.anchorEnd });
      notifyDocument(project.id, existing.document.id);
      return { thread: toThreadSummary(resolved, comments, quotedText) };
    },
  );

  app.post<{ Params: ThreadRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments/:threadId/reopen',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'comment')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();
      const repo = createTenantDb(pool).forOrg(org.id).docComments;
      const thread = await repo.findThread(req.params.threadId);
      if (!thread || thread.documentId !== existing.document.id) throw new NotFoundError();

      await enforceCommentRateLimit(req, reply, session.user.id, existing.document.id);

      const reopened = await repo.reopenThread(thread.id);
      if (!reopened) throw new NotFoundError();
      const [comments, { ydoc }] = await Promise.all([repo.listCommentsForThread(thread.id), reconstructLiveYDoc(pool, org.id, existing.document.id)]);
      const { quotedText } = resolveCommentAnchor(ydoc, { start: reopened.anchorStart, end: reopened.anchorEnd });
      notifyDocument(project.id, existing.document.id);
      return { thread: toThreadSummary(reopened, comments, quotedText) };
    },
  );

  app.delete<{ Params: CommentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments/:threadId/messages/:commentId',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'comment')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();
      const repo = createTenantDb(pool).forOrg(org.id).docComments;
      const thread = await repo.findThread(req.params.threadId);
      if (!thread || thread.documentId !== existing.document.id) throw new NotFoundError();
      const comment = await repo.findComment(req.params.commentId);
      if (!comment || comment.threadId !== thread.id) throw new NotFoundError();

      const canDeleteOthers = can(subject, 'delete_others_comments');
      const deleted = await repo.softDeleteComment(req.params.commentId, canDeleteOthers ? undefined : session.user.id);
      if (!deleted) throw new ForbiddenError();

      notifyDocument(project.id, existing.document.id);
      return { comment: toCommentSummary(deleted) };
    },
  );
}
