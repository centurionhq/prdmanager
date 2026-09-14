/**
 * The collaborative body editor (SDD-008 §"Editor"): CodeMirror 6 bound to the live `Y.Text('body')` via
 * `y-codemirror.next`'s `yCollab`, connected through a `HocuspocusProvider`. Shows connection status,
 * presence, and a read-only banner driven entirely by what the server actually authorized (never a
 * client-side guess re-derived from the caller's own role) — matches `authorize-document.ts`'s own logic
 * by construction, since `scope` comes straight from the server's `onAuthenticate` result.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { EditorView } from '@codemirror/view';
import { buildEditorExtensions, readCspNonce } from '../collab/editor-extensions.js';
import { setBlame } from '../collab/blame-gutter.js';
import { useCollabDocumentContext } from '../collab/collab-document-context.js';
import { useStatelessMessage } from '../collab/use-stateless-message.js';
import { getDocumentBlame } from '../api/documents.js';
import { MarkdownPreview } from './MarkdownPreview.js';
import styles from '../styles/editor.module.css';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Conectando…',
  connected: 'Conectado',
  disconnected: 'Desconectado',
};

/** Renders inside a `CollabDocumentProvider` (`../routes/DocumentDetail.js`) — never creates its own
 * `HocuspocusProvider`, so it always shares the exact same connection/awareness identity as the
 * frontmatter form and every other panel on the same document page. */
export function CollabEditor(): ReactElement {
  const { provider, state, orgSlug, projectSlug, docId, setEditorView } = useCollabDocumentContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [bodyText, setBodyText] = useState('');

  const readOnly = state.scope === 'readonly';

  useEffect(() => {
    if (!provider || !containerRef.current) return;
    const view = new EditorView({
      doc: provider.document.getText('body').toString(),
      extensions: buildEditorExtensions({ provider, readOnly, cspNonce: readCspNonce() }),
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
    };
    // `readOnly` intentionally excluded: it's re-derived from `state.scope`, which never changes after
    // the initial `authenticated` event for a real connection — a genuine mid-session role downgrade
    // closes the connection instead (WO-148), so there is nothing here to react to by tearing the view
    // down and losing local (unsaved-to-Yjs-yet, though rare) cursor state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

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
        <button type="button" className={styles.previewToggle} aria-pressed={showPreview} onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? 'Editor' : 'Vista previa'}
        </button>
      </div>
      {/* Kept mounted (never unmounted) while previewing — CodeMirror re-creating its view on every
          toggle would lose scroll position/undo history for no reason; hiding it visually is enough. */}
      <div ref={containerRef} className={styles.editorContainer} data-testid="collab-editor-container" hidden={showPreview} />
      {showPreview && (
        <div className={styles.preview} data-testid="markdown-preview">
          <MarkdownPreview body={bodyText} />
        </div>
      )}
      {!editorReady && <p className={styles.loading}>Cargando editor…</p>}
    </div>
  );
}
