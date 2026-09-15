/**
 * One `HocuspocusProvider` per document page, shared by every panel that needs it (the CodeMirror body
 * editor, WO-159; the frontmatter form, WO-160; blame gutter, comments, versions and validation panels,
 * WO-161-164) — each panel binding its own separate connection would waste a socket per panel and, worse,
 * give each one its *own* awareness/presence state instead of one shared "this is what I'm looking at"
 * identity per browser tab.
 *
 * Also carries the document's route identifiers (`orgSlug`/`projectSlug`/`docId`) alongside the live
 * connection: every HTTP panel (blame, comments, versions, validation) needs these for its own
 * `/api/app/...` calls, and threading them as a prop through every panel component individually would
 * just be this same context reinvented per panel.
 */
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import { useCollabProvider, type UseCollabProviderResult } from './use-collab-provider.js';

export interface CollabDocumentIdentity {
  orgSlug: string;
  projectSlug: string;
  /** The human `KIND-NNN` id (`documents.doc_id`), what every `/api/app/.../documents/:docId/*` route
   * expects in its URL — never the internal uuid (`../document-name.js`'s `formatCollabDocumentName`
   * uses that separately, for the `/collab` `documentName` itself). */
  docId: string;
}

export interface EditorViewHandle {
  /** `null` until `CollabEditor` has actually mounted its `EditorView` (and again once it unmounts) —
   * every consumer (WO-162's comments panel dispatching highlight decorations/scrolling to an anchor)
   * must check for `null` rather than assume the editor is always present. */
  editorView: EditorView | null;
  setEditorView: (view: EditorView | null) => void;
}

export type CollabDocumentContextValue = UseCollabProviderResult & CollabDocumentIdentity & EditorViewHandle;

const CollabDocumentReactContext = createContext<CollabDocumentContextValue | null>(null);

export interface CollabDocumentProviderProps extends CollabDocumentIdentity {
  documentName: string | null;
  children: ReactNode;
}

export function CollabDocumentProvider({ documentName, children, ...identity }: CollabDocumentProviderProps): ReactElement {
  const connection = useCollabProvider(documentName);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  return <CollabDocumentReactContext.Provider value={{ ...connection, ...identity, editorView, setEditorView }}>{children}</CollabDocumentReactContext.Provider>;
}

/** Throws outside a `CollabDocumentProvider` — every consumer is only ever rendered inside one, same
 * reasoning as `useOrgShellContext` elsewhere in this app. */
export function useCollabDocumentContext(): CollabDocumentContextValue {
  const ctx = useContext(CollabDocumentReactContext);
  if (!ctx) throw new Error('useCollabDocumentContext must be used within a CollabDocumentProvider');
  return ctx;
}
