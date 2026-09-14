/**
 * One `HocuspocusProvider` per document page, shared by every panel that needs it (the CodeMirror body
 * editor, WO-159; the frontmatter form, WO-160; blame gutter, comments, versions and validation panels,
 * WO-161-164) — each panel binding its own separate connection would waste a socket per panel and, worse,
 * give each one its *own* awareness/presence state instead of one shared "this is what I'm looking at"
 * identity per browser tab.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { useCollabProvider, type UseCollabProviderResult } from './use-collab-provider.js';

const CollabDocumentReactContext = createContext<UseCollabProviderResult | null>(null);

export interface CollabDocumentProviderProps {
  documentName: string | null;
  children: ReactNode;
}

export function CollabDocumentProvider({ documentName, children }: CollabDocumentProviderProps): ReactElement {
  const value = useCollabProvider(documentName);
  return <CollabDocumentReactContext.Provider value={value}>{children}</CollabDocumentReactContext.Provider>;
}

/** Throws outside a `CollabDocumentProvider` — every consumer is only ever rendered inside one, same
 * reasoning as `useOrgShellContext` elsewhere in this app. */
export function useCollabDocumentContext(): UseCollabProviderResult {
  const ctx = useContext(CollabDocumentReactContext);
  if (!ctx) throw new Error('useCollabDocumentContext must be used within a CollabDocumentProvider');
  return ctx;
}
