/**
 * `.../documents/:docId/comments*` validation and response shapes (SDD-008 §"Comentarios", WO-158).
 *
 * `DOC_COMMENT_BODY_MAX_LENGTH` mirrors `@prdm/db`'s schema-level `CHECK` constraint by hand (same
 * SDD-006 §Arquitectura reasoning as every other hand-synced limit in this package) — this is the
 * fast, user-facing 400 the CHECK constraint would otherwise only surface as an opaque 500.
 */
import { z } from 'zod';

export const DOC_COMMENT_BODY_MAX_LENGTH = 10 * 1024;

/** Same character classes the database CHECK constraint rejects (see `@prdm/db`'s
 * `doc-comments.ts`) — C0 control characters and DEL, but not `\t`/`\n`/`\r`. */
const CONTROL_CHAR_PATTERN = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const commentBodySchema = z
  .string()
  .min(1)
  .max(DOC_COMMENT_BODY_MAX_LENGTH)
  .refine((value) => !CONTROL_CHAR_PATTERN.test(value), 'comment body must not contain control characters');

export const createCommentThreadInputSchema = z.object({
  /** Character offsets into the live `body` Y.Text at the moment of creation — the server resolves these
   * into a `Y.RelativePosition` anchor immediately, so they only need to be accurate at request time. */
  startIndex: z.number().int().min(0),
  endIndex: z.number().int().min(0),
  body: commentBodySchema,
});
export type CreateCommentThreadInput = z.infer<typeof createCommentThreadInputSchema>;

export const replyToCommentThreadInputSchema = z.object({
  body: commentBodySchema,
});
export type ReplyToCommentThreadInput = z.infer<typeof replyToCommentThreadInputSchema>;

export const commentSummarySchema = z.object({
  id: z.string(),
  authorId: z.string(),
  body: z.string().nullable(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});
export type CommentSummary = z.infer<typeof commentSummarySchema>;

export const commentThreadSummarySchema = z.object({
  id: z.string(),
  documentId: z.string(),
  /** Recomputed live from the current anchor position on every read (server-side) — `null` means the
   * anchored text no longer exists ("sin ancla"), never a crash or a stale copy. */
  quotedText: z.string().nullable(),
  /** Base64-encoded `Y.RelativePosition` bytes (`@prdm/collab`'s `EncodedCommentAnchor`) — so the client
   * can resolve the *live* absolute position itself (jump-to-anchor scrolling, WO-162's in-editor
   * highlight decorations), rather than only ever seeing the server's last-fetched `quotedText` snapshot. */
  anchorStart: z.string(),
  anchorEnd: z.string(),
  status: z.enum(['open', 'resolved']),
  createdBy: z.string(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  comments: z.array(commentSummarySchema),
});
export type CommentThreadSummary = z.infer<typeof commentThreadSummarySchema>;
