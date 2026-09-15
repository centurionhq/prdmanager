/**
 * The collaborative body editor (SDD-008 §"Editor"): CodeMirror 6 bound to the live `Y.Text('body')` via
 * `y-codemirror.next`'s `yCollab`, connected through a `HocuspocusProvider`. Shows connection status,
 * presence, and a read-only banner driven entirely by what the server actually authorized (never a
 * client-side guess re-derived from the caller's own role) — matches `authorize-document.ts`'s own logic
 * by construction, since `scope` comes straight from the server's `onAuthenticate` result.
 *
 * WO-214: also the "create a comment thread from a selection" trigger — a toolbar button that only exists
 * while the current CodeMirror selection is non-empty and `subject` may comment, opening a small inline
 * form that calls the already-existing `POST .../comments` endpoint (WO-158) with the selection's
 * character offsets. The new thread shows up in `CommentsPanel`/the highlight decorations on its own, via
 * the `comment:updated` stateless broadcast the create route already sends — this component never
 * refreshes those itself.
 *
 * WO-358: "Vista previa"/"Markdown" tabs (`Documento.dc.html`) replace the old single toggle button —
 * "Vista previa" (the read-only `MarkdownPreview` bridge SDD-013 describes until the lossless block
 * editor, ADR-009/SDD-014, replaces it) is the default tab, matching the canvas. The CodeMirror container
 * stays mounted at all times regardless of which tab is active (only visually `hidden`) — recreating it on
 * every tab switch would lose scroll position/undo history for nothing.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { EditorView } from '@codemirror/view';
import { can, type PermissionSubject } from '@prdm/contracts';
import { buildEditorExtensions, readCspNonce } from '../collab/editor-extensions.js';
import { setBlame } from '../collab/blame-gutter.js';
import { useCollabDocumentContext } from '../collab/collab-document-context.js';
import { useStatelessMessage } from '../collab/use-stateless-message.js';
import { getDocumentBlame } from '../api/documents.js';
import { createCommentThread } from '../api/comments.js';
import { errorMessage } from '../api/error-message.js';
import { DocumentStateBanner, type DocumentBannerVariant } from './DocumentStateBanner/DocumentStateBanner.js';
import { MarkdownPreview } from './MarkdownPreview.js';
import styles from '../styles/editor.module.css';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Conectando…',
  connected: 'Conectado',
  disconnected: 'Desconectado',
};

export interface CollabEditorProps {
  subject: PermissionSubject;
  /** The document's real `workflowState === 'archived'` — shows the "archivado" banner and, combined with
   * the server-authorized `readonly` scope archiving a document already implies, disables editing. */
  archived?: boolean;
}

function bannerVariantFor(status: string, archived: boolean, readOnly: boolean): DocumentBannerVariant | null {
  if (status === 'disconnected') return 'desconectado';
  if (archived) return 'archivado';
  if (readOnly) return 'solo_lectura';
  return null;
}

/** Renders inside a `CollabDocumentProvider` (`../routes/DocumentDetail.js`) — never creates its own
 * `HocuspocusProvider`, so it always shares the exact same connection/awareness identity as the
 * frontmatter form and every other panel on the same document page. */
export function CollabEditor({ subject, archived = false }: CollabEditorProps): ReactElement {
  const { provider, state, orgSlug, projectSlug, docId, setEditorView } = useCollabDocumentContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [bodyText, setBodyText] = useState('');
  // WO-214: `null` whenever the selection is empty — the trigger button is simply absent then, never a
  // disabled button with an unclear reason (SDD-008's own comment UI is transient, tied to selection).
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const readOnly = state.scope === 'readonly';
  const canComment = can(subject, 'comment');

  useEffect(() => {
    if (!provider || !containerRef.current) return;
    const view = new EditorView({
      doc: provider.document.getText('body').toString(),
      extensions: [
        ...buildEditorExtensions({ provider, readOnly, cspNonce: readCspNonce() }),
        EditorView.updateListener.of((update) => {
          if (!update.selectionSet) return;
          const { from, to } = update.state.selection.main;
          setSelection(from === to ? null : { from, to });
        }),
      ],
      parent: containerRef.current,
    });
    viewRef.current = view;
    setEditorView(view);
    setEditorReady(true);
    return () => {
      view.destroy();
      viewRef.current = null;
      setEditorView(null);
      setEditorReady(false);
      setSelection(null);
      setShowCommentForm(false);
    };
    // `readOnly` intentionally excluded: it's re-derived from `state.scope`, which never changes after
    // the initial `authenticated` event for a real connection — a genuine mid-session role downgrade
    // closes the connection instead (WO-148), so there is nothing here to react to by tearing the view
    // down and losing local (unsaved-to-Yjs-yet, though rare) cursor state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // A selection that collapses (e.g. the user clicks elsewhere) closes any still-open inline form too —
  // there is nothing left to anchor a new thread to.
  useEffect(() => {
    if (!selection) setShowCommentForm(false);
  }, [selection]);

  async function handleCreateComment(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selection) return;
    const body = commentDraft.trim();
    if (!body) return;
    setCommentBusy(true);
    setCommentError(null);
    try {
      await createCommentThread(orgSlug, projectSlug, docId, { startIndex: selection.from, endIndex: selection.to, body });
      setCommentDraft('');
      setShowCommentForm(false);
    } catch (err) {
      setCommentError(errorMessage(err));
    } finally {
      setCommentBusy(false);
    }
  }

  function closeCommentForm(): void {
    setShowCommentForm(false);
    setCommentDraft('');
    setCommentError(null);
  }

  // WO-161: fetches once the editor mounts, then again on every blame:stale broadcast (WO-154) — never
  // polling, never a timer.
  function refetchBlame(): void {
    getDocumentBlame(orgSlug, projectSlug, docId)
      .then((blame) => viewRef.current?.dispatch({ effects: setBlame.of(blame) }))
      .catch(() => undefined); // best-effort: a failed blame fetch never blocks editing
  }
  useEffect(() => {
    if (editorReady) refetchBlame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorReady]);
  useStatelessMessage(provider, 'blame:stale', refetchBlame);

  // WO-165: the preview always reflects the live Y.Text('body'), never a stale server-fetched copy —
  // kept in a plain React string mirror only while the preview toggle is actually on, so typing in the
  // editor doesn't re-render a hidden ReactMarkdown tree on every keystroke for nothing.
  useEffect(() => {
    if (!provider || !showPreview) return;
    const body = provider.document.getText('body');
    const sync = () => setBodyText(body.toString());
    sync();
    body.observe(sync);
    return () => body.unobserve(sync);
  }, [provider, showPreview]);

  const banner = bannerVariantFor(state.status, archived, readOnly);

  return (
    <div className={styles.editorShell}>
      <div className={styles.statusBar} role="status">
        <span className={styles.statusDot} data-status={state.status} aria-hidden="true" />
        <span>{STATUS_LABEL[state.status] ?? state.status}</span>
        {state.synced && <span className={styles.synced}>Sincronizado</span>}
        {readOnly && (
          <span className={styles.readOnlyBadge} role="alert">
            Solo lectura
          </span>
        )}
        {state.presence.length > 0 && (
          <span className={styles.presence} aria-label="Personas conectadas">
            {state.presence.map((p) => (
              <span key={p.clientId} className={styles.presenceChip} style={{ borderColor: p.color, color: p.color }}>
                {p.name}
              </span>
            ))}
          </span>
        )}
        {canComment && selection && !showCommentForm && (
          <button type="button" className={styles.commentTrigger} onClick={() => setShowCommentForm(true)}>
            Comentar selección
          </button>
        )}
      </div>

      {banner && <DocumentStateBanner variant={banner} />}

      <div className={styles.tabsBar}>
        <div role="tablist" aria-label="Modo del editor" className={styles.tabs}>
          <button
            type="button"
            role="tab"
            id="editor-tab-preview"
            aria-selected={showPreview}
            aria-controls="editor-panel-preview"
            className={showPreview ? styles.tabActive : styles.tab}
            onClick={() => setShowPreview(true)}
          >
            Vista previa
          </button>
          <button
            type="button"
            role="tab"
            id="editor-tab-markdown"
            aria-selected={!showPreview}
            aria-controls="editor-panel-markdown"
            className={!showPreview ? styles.tabActive : styles.tab}
            onClick={() => setShowPreview(false)}
          >
            Markdown
          </button>
        </div>
        <span className={styles.authorNote}>Autoría por bloque</span>
      </div>

      {canComment && selection && showCommentForm && (
        <form className={styles.commentForm} onSubmit={(event: FormEvent) => void handleCreateComment(event)}>
          <label htmlFor="new-comment-body" className={styles.srOnly}>
            Nuevo comentario
          </label>
          <input
            id="new-comment-body"
            type="text"
            className={styles.commentInput}
            aria-label="Nuevo comentario"
            autoFocus
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              closeCommentForm();
            }}
          />
          <button type="submit" className={styles.smallButton} disabled={commentBusy || !commentDraft.trim()}>
            Comentar
          </button>
          <button type="button" className={styles.smallButton} onClick={closeCommentForm}>
            Cancelar
          </button>
        </form>
      )}
      {commentError && (
        <p role="alert" className={styles.commentError}>
          {commentError}
        </p>
      )}
      {showPreview && (
        <div id="editor-panel-preview" role="tabpanel" aria-labelledby="editor-tab-preview" className={styles.preview} data-testid="markdown-preview">
          <MarkdownPreview body={bodyText} />
        </div>
      )}
      {/* Kept mounted (never unmounted) while previewing — CodeMirror re-creating its view on every
          tab switch would lose scroll position/undo history for no reason; hiding it visually is enough. */}
      <div
        ref={containerRef}
        id="editor-panel-markdown"
        role="tabpanel"
        aria-labelledby="editor-tab-markdown"
        className={styles.editorContainer}
        data-testid="collab-editor-container"
        hidden={showPreview}
      />
      {!editorReady && <p className={styles.loading}>Cargando editor…</p>}
    </div>
  );
}
