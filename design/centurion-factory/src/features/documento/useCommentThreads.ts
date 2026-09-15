/** Comment threads for a document: replying and resolving. */
import { useState } from 'react';
import { commentsForDocument, type CommentThread } from '../../data';
import { CURRENT_USER_ID } from './documentEditorConstants';

export interface UseCommentThreadsResult {
  readonly comments: readonly CommentThread[];
  readonly addReply: (threadId: string, body: string) => void;
  readonly resolveThread: (threadId: string) => void;
}

export function useCommentThreads(id: string): UseCommentThreadsResult {
  const [comments, setComments] = useState<readonly CommentThread[]>(() => [...commentsForDocument(id)]);

  function addReply(threadId: string, body: string): void {
    setComments((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? { ...thread, comments: [...thread.comments, { authorId: CURRENT_USER_ID, body, createdAt: new Date().toISOString() }] }
          : thread,
      ),
    );
  }

  function resolveThread(threadId: string): void {
    setComments((current) =>
      current.map((thread) => (thread.id === threadId ? { ...thread, status: 'resolved', resolvedBy: CURRENT_USER_ID } : thread)),
    );
  }

  return { comments, addReply, resolveThread };
}
