/**
 * `doc_comment_threads`/`doc_comments` repository (SDD-008 §"Comentarios", WO-158) — tenant-scoped the
 * same way every other repository in `repositories.ts` is. Anchoring (`Y.RelativePosition` encode/decode,
 * live `quoted_text` recomputation) is `@prdm/collab`'s `comment-anchor.ts`'s job, kept isomorphic and
 * database-free; this module only ever stores/reads the encoded anchor bytes.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Pool } from 'pg';
import { docComments, docCommentThreads } from './schema/doc-comments.js';
import { withTenantTx } from './tenant.js';

export type DocCommentThreadRecord = typeof docCommentThreads.$inferSelect;
export type DocCommentRecord = typeof docComments.$inferSelect;

export interface CreateThreadInput {
  documentId: string;
  anchorStart: Buffer;
  anchorEnd: Buffer;
  quotedText: string;
  createdBy: string;
  body: string;
}

export interface ThreadWithComments {
  thread: DocCommentThreadRecord;
  comments: DocCommentRecord[];
}

export interface DocCommentsRepository {
  createThread(input: CreateThreadInput): Promise<ThreadWithComments>;
  /** Every thread for `documentId`, each with its (non-deleted-filtered — soft-deleted comments stay in
   * the list, `deletedAt` set, so the route layer can render "[comment deleted]") comments oldest first. */
  listThreads(documentId: string): Promise<ThreadWithComments[]>;
  findThread(threadId: string): Promise<DocCommentThreadRecord | null>;
  findComment(commentId: string): Promise<DocCommentRecord | null>;
  listCommentsForThread(threadId: string): Promise<DocCommentRecord[]>;
  addReply(threadId: string, authorId: string, body: string): Promise<DocCommentRecord>;
  /** `null` when `threadId` doesn't exist — always succeeds (idempotently) for an already-resolved
   * thread, since re-resolving isn't a meaningful error case. */
  resolveThread(threadId: string, resolvedBy: string): Promise<DocCommentThreadRecord | null>;
  reopenThread(threadId: string): Promise<DocCommentThreadRecord | null>;
  /** Soft delete (`deleted_at`) — `requireAuthorId`, when given, guards the update to that comment's own
   * author (a non-admin caller); omitted for an admin deleting anyone's. `null` when no row matched
   * (wrong id, or `requireAuthorId` didn't match — both map to the same "cannot delete this" outcome). */
  softDeleteComment(commentId: string, requireAuthorId?: string): Promise<DocCommentRecord | null>;
}

export function buildDocCommentsRepository(pool: Pool, orgId: string): DocCommentsRepository {
  return {
    createThread: (input) =>
      withTenantTx(pool, orgId, async (tx) => {
        const [thread] = await tx
          .insert(docCommentThreads)
          .values({
            orgId,
            documentId: input.documentId,
            anchorStart: input.anchorStart,
            anchorEnd: input.anchorEnd,
            quotedText: input.quotedText,
            createdBy: input.createdBy,
          })
          .returning();
        if (!thread) throw new Error(`failed to create comment thread for document ${input.documentId}`);

        const [comment] = await tx.insert(docComments).values({ orgId, threadId: thread.id, authorId: input.createdBy, body: input.body }).returning();
        if (!comment) throw new Error(`failed to create opening comment for thread ${thread.id}`);

        return { thread, comments: [comment] };
      }),

    listThreads: (documentId) =>
      withTenantTx(pool, orgId, async (tx) => {
        const threads = await tx.select().from(docCommentThreads).where(eq(docCommentThreads.documentId, documentId)).orderBy(asc(docCommentThreads.createdAt));
        const result: ThreadWithComments[] = [];
        for (const thread of threads) {
          const comments = await tx.select().from(docComments).where(eq(docComments.threadId, thread.id)).orderBy(asc(docComments.createdAt));
          result.push({ thread, comments });
        }
        return result;
      }),

    findThread: (threadId) =>
      withTenantTx(pool, orgId, async (tx) => (await tx.select().from(docCommentThreads).where(eq(docCommentThreads.id, threadId)))[0] ?? null),

    findComment: (commentId) => withTenantTx(pool, orgId, async (tx) => (await tx.select().from(docComments).where(eq(docComments.id, commentId)))[0] ?? null),

    listCommentsForThread: (threadId) => withTenantTx(pool, orgId, (tx) => tx.select().from(docComments).where(eq(docComments.threadId, threadId)).orderBy(asc(docComments.createdAt))),

    addReply: (threadId, authorId, body) =>
      withTenantTx(pool, orgId, async (tx) => {
        const [comment] = await tx.insert(docComments).values({ orgId, threadId, authorId, body }).returning();
        if (!comment) throw new Error(`failed to add reply to thread ${threadId}`);
        return comment;
      }),

    resolveThread: (threadId, resolvedBy) =>
      withTenantTx(pool, orgId, async (tx) => {
        const [row] = await tx.update(docCommentThreads).set({ status: 'resolved', resolvedBy, resolvedAt: new Date() }).where(eq(docCommentThreads.id, threadId)).returning();
        return row ?? null;
      }),

    reopenThread: (threadId) =>
      withTenantTx(pool, orgId, async (tx) => {
        const [row] = await tx.update(docCommentThreads).set({ status: 'open', resolvedBy: null, resolvedAt: null }).where(eq(docCommentThreads.id, threadId)).returning();
        return row ?? null;
      }),

    softDeleteComment: (commentId, requireAuthorId) =>
      withTenantTx(pool, orgId, async (tx) => {
        const conditions = [eq(docComments.id, commentId), isNull(docComments.deletedAt)];
        if (requireAuthorId) conditions.push(eq(docComments.authorId, requireAuthorId));
        const [row] = await tx.update(docComments).set({ deletedAt: new Date() }).where(and(...conditions)).returning();
        return row ?? null;
      }),
  };
}
