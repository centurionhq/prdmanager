/**
 * "Comentarios" side panel tab (WO-290): threads quoting a piece of the document, their messages,
 * a reply box, a Resolver action and a "Mostrar resueltos" toggle.
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Button } from '../../components';
import { getPerson, type CommentThread } from '../../data';
import styles from './CommentsTab.module.css';
import { formatRelative } from './format';

export interface CommentsTabProps {
  readonly threads: readonly CommentThread[];
  readonly onReply: (threadId: string, body: string) => void;
  readonly onResolve: (threadId: string) => void;
}

function ThreadCard({ thread, onReply, onResolve }: { readonly thread: CommentThread; readonly onReply: (body: string) => void; readonly onResolve: () => void }): ReactElement {
  const [draft, setDraft] = useState('');
  const replyId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft.trim()) return;
    onReply(draft.trim());
    setDraft('');
  }

  return (
    <li className={styles.thread}>
      <p className={styles.quote}>“{thread.quotedText}”</p>
      <ul className={styles.messages}>
        {thread.comments.map((message, index) => {
          const person = getPerson(message.authorId);
          return (
            <li key={`${thread.id}-${index}`} className={styles.message}>
              <span className={styles.avatar} aria-hidden="true">
                {person?.initials ?? message.authorId.slice(0, 2).toUpperCase()}
              </span>
              <div className={styles.messageBody}>
                <div className={styles.messageHeader}>
                  <span className={styles.messageAuthor}>{person?.name ?? message.authorId}</span>
                  <span className={styles.messageTime}>{formatRelative(message.createdAt)}</span>
                </div>
                <p className={styles.messageText}>{message.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {thread.status === 'resolved' ? (
        <p className={styles.resolvedNote}>Resuelto por {getPerson(thread.resolvedBy ?? '')?.name ?? thread.resolvedBy}.</p>
      ) : (
        <form className={styles.replyForm} onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor={replyId}>
            Responder al hilo
          </label>
          <input id={replyId} className={styles.replyInput} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Responder…" />
          <div className={styles.threadActions}>
            <Button type="submit" variant="secondary" size="sm">
              Responder
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onResolve}>
              Resolver
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

export function CommentsTab({ threads, onReply, onResolve }: CommentsTabProps): ReactElement {
  const [showResolved, setShowResolved] = useState(false);
  const visible = showResolved ? threads : threads.filter((thread) => thread.status === 'open');

  return (
    <div className={styles.tab}>
      <label className={styles.toggle}>
        <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
        Mostrar resueltos
      </label>
      {visible.length === 0 ? (
        <p>Sin comentarios abiertos.</p>
      ) : (
        <ul className={styles.threadList}>
          {visible.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} onReply={(body) => onReply(thread.id, body)} onResolve={() => onResolve(thread.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
