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
import { formatCollabDocumentName } from '../collab/document-name.js';
import { useCollabProvider } from '../collab/use-collab-provider.js';
import styles from '../styles/editor.module.css';

export interface CollabEditorProps {
  projectId: string;
  documentId: string;
}

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Conectando…',
  connected: 'Conectado',
  disconnected: 'Desconectado',
};

export function CollabEditor({ projectId, documentId }: CollabEditorProps): ReactElement {
  const documentName = formatCollabDocumentName(projectId, documentId);
  const { provider, state } = useCollabProvider(documentName);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  const readOnly = state.scope === 'readonly';

  useEffect(() => {
    if (!provider || !containerRef.current) return;
    const view = new EditorView({
      doc: provider.document.getText('body').toString(),
      extensions: buildEditorExtensions({ provider, readOnly, cspNonce: readCspNonce() }),
      parent: containerRef.current,
    });
    setEditorReady(true);
    return () => {
      view.destroy();
      setEditorReady(false);
    };
    // `readOnly` intentionally excluded: it's re-derived from `state.scope`, which never changes after
    // the initial `authenticated` event for a real connection — a genuine mid-session role downgrade
    // closes the connection instead (WO-148), so there is nothing here to react to by tearing the view
    // down and losing local (unsaved-to-Yjs-yet, though rare) cursor state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

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
      </div>
      <div ref={containerRef} className={styles.editorContainer} data-testid="collab-editor-container" />
      {!editorReady && <p className={styles.loading}>Cargando editor…</p>}
    </div>
  );
}
