/**
 * Comments panel (SDD-008 §"Comentarios", WO-162): list threads (open/resolved filter), reply,
 * resolve/reopen (gated by `can(subject, 'comment')`), delete-own-or-any (gated by
 * `delete_others_comments` for someone else's), and jump-to-anchor — selecting a thread scrolls the body
 * editor to its live anchor position and briefly highlights it. Open threads are always highlighted in
 * the editor itself (`../collab/comment-highlight.js`), independent of which thread is selected here.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { EditorView } from '@codemirror/view';
import { can, type CommentThreadSummary, type PermissionSubject } from '@prdm/contracts';
import { deleteComment, listCommentThreads, replyToCommentThread, reopenCommentThread, resolveCommentThread } from '../api/comments.js';
import { useCollabDocumentContext } from '../collab/collab-document-context.js';
import { useStatelessMessage } from '../collab/use-stateless-message.js';
import { resolveOpenThreadHighlights, setCommentHighlights } from '../collab/comment-highlight.js';
import { errorMessage } from '../api/error-message.js';
import styles from '../styles/comments-panel.module.css';

export interface CommentsPanelProps {
  subject: PermissionSubject;
}

type StatusFilter = 'open' | 'resolved' | 'all';

export function CommentsPanel({ subject }: CommentsPanelProps): ReactElement {
  const { provider, orgSlug, projectSlug, docId, editorView } = useCollabDocumentContext();
  const [threads, setThreads] = useState<CommentThreadSummary[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [error, setError] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  function reload(): void {
    listCommentThreads(orgSlug, projectSlug, docId)
      .then(setThreads)
      .catch((err: unknown) => setError(errorMessage(err)));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, projectSlug, docId]);
  useStatelessMessage(provider, 'comment:updated', reload);

  useEffect(() => {
    if (!provider || !editorView) return;
    const highlights = resolveOpenThreadHighlights(provider.document, threads);
    editorView.dispatch({ effects: setCommentHighlights.of(highlights) });
  }, [provider, editorView, threads]);

  const canComment = can(subject, 'comment');
  // Delete is shown to any commenter (never hidden based on `delete_others_comments` here) — the server
  // always re-checks authorship/role on every call (SDD-008: "Acciones siempre por HTTP con rol
  // re-leído en cada llamada"), so attempting to delete someone else's comment without that permission
  // simply surfaces a 403 via `error`, rather than this panel trying to predict the outcome client-side.
  const visibleThreads = threads.filter((t) => filter === 'all' || t.status === filter);

  function jumpToThread(thread: CommentThreadSummary): void {
    setSelectedThreadId(thread.id);
    if (!provider || !editorView) return;
    const [highlight] = resolveOpenThreadHighlights(provider.document, [{ ...thread, status: 'open' }]);
    if (!highlight) return;
    editorView.dispatch({ selection: { anchor: highlight.from, head: highlight.to }, effects: EditorView.scrollIntoView(highlight.from, { y: 'center' }) });
    editorView.focus();
  }

  async function handleReply(threadId: string): Promise<void> {
    const body = (replyDrafts[threadId] ?? '').trim();
    if (!body) return;
    try {
      await replyToCommentThread(orgSlug, projectSlug, docId, threadId, { body });
      setReplyDrafts((prev) => ({ ...prev, [threadId]: '' }));
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleResolve(threadId: string): Promise<void> {
    try {
      await resolveCommentThread(orgSlug, projectSlug, docId, threadId);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleReopen(threadId: string): Promise<void> {
    try {
      await reopenCommentThread(orgSlug, projectSlug, docId, threadId);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDelete(threadId: string, commentId: string): Promise<void> {
    try {
      await deleteComment(orgSlug, projectSlug, docId, threadId, commentId);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className={styles.panel} aria-label="Comentarios">
      <div className={styles.filters} role="group" aria-label="Filtrar comentarios">
        {(['open', 'resolved', 'all'] as const).map((value) => (
          <button key={value} type="button" className={filter === value ? styles.filterActive : styles.filter} onClick={() => setFilter(value)}>
            {value === 'open' ? 'Abiertos' : value === 'resolved' ? 'Resueltos' : 'Todos'}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <ul className={styles.threadList}>
        {visibleThreads.map((thread) => (
          <li key={thread.id} className={thread.id === selectedThreadId ? styles.threadSelected : styles.thread}>
            <button type="button" className={styles.quotedText} onClick={() => jumpToThread(thread)}>
              {thread.quotedText ?? 'texto eliminado'}
            </button>
            <ul className={styles.commentList}>
              {thread.comments.map((comment) => (
                <li key={comment.id} className={styles.comment}>
                  <p className={styles.commentBody}>{comment.body ?? '[comentario eliminado]'}</p>
                  {!comment.deletedAt && canComment && (
                    <button type="button" className={styles.linkButton} onClick={() => handleDelete(thread.id, comment.id)}>
                      Borrar
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {canComment && (
              <form
                className={styles.replyForm}
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  void handleReply(thread.id);
                }}
              >
                <input
                  type="text"
                  className={styles.replyInput}
                  aria-label={`Responder al hilo sobre "${thread.quotedText ?? 'texto eliminado'}"`}
                  value={replyDrafts[thread.id] ?? ''}
                  onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [thread.id]: e.target.value }))}
                />
                <button type="submit" className={styles.smallButton}>
                  Responder
                </button>
              </form>
            )}

            {canComment && (
              <div className={styles.threadActions}>
                {thread.status === 'open' ? (
                  <button type="button" className={styles.smallButton} onClick={() => handleResolve(thread.id)}>
                    Resolver
                  </button>
                ) : (
                  <button type="button" className={styles.smallButton} onClick={() => handleReopen(thread.id)}>
                    Reabrir
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
        {visibleThreads.length === 0 && <li className={styles.empty}>Sin comentarios.</li>}
      </ul>
    </section>
  );
}
