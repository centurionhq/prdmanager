/**
 * `HocuspocusProvider` lifecycle as a React hook (SDD-008 §"Editor"): one provider per `documentName`,
 * torn down and recreated whenever it changes, always destroyed on unmount — never leaked across
 * navigations (`DocumentDetail` unmounting when the user leaves the page must close the socket).
 *
 * `authorizedScope` (`'read-write' | 'readonly'`) is the server's own per-document authorization result
 * (SDD-008 §"Servidor de tiempo real": viewer/commenter/developer roles, or a `generated`/`archived`
 * document, connect read-only) — read straight off the provider's `authenticated` event, never
 * re-derived from the caller's own guess at the project role, since only the server actually knows.
 */
import { useEffect, useRef, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

export type CollabConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type CollabAuthorizedScope = 'read-write' | 'readonly';

export interface CollabPresenceEntry {
  clientId: number;
  name: string;
  color: string;
}

export interface CollabConnectionState {
  status: CollabConnectionStatus;
  synced: boolean;
  scope: CollabAuthorizedScope | null;
  presence: CollabPresenceEntry[];
}

export interface UseCollabProviderResult {
  provider: HocuspocusProvider | null;
  state: CollabConnectionState;
}

function collabWebsocketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/collab`;
}

function readPresence(provider: HocuspocusProvider): CollabPresenceEntry[] {
  const presence: CollabPresenceEntry[] = [];
  provider.awareness?.getStates().forEach((state, clientId) => {
    if (clientId === provider.document.clientID) return; // never list yourself as a "peer"
    const user = (state as { user?: { name?: string; color?: string } }).user;
    if (!user?.name) return;
    presence.push({ clientId, name: user.name, color: user.color ?? 'var(--color-fg-muted)' });
  });
  return presence;
}

/** `documentName` is `<projectUuid>:<documentUuid>` (`../collab/document-name.js`) — `null` while the
 * caller doesn't yet know both ids (e.g. still loading the document/project), in which case no provider
 * is created at all. */
export function useCollabProvider(documentName: string | null): UseCollabProviderResult {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [state, setState] = useState<CollabConnectionState>({ status: 'connecting', synced: false, scope: null, presence: [] });
  // Guards against a stale async callback (e.g. `onAuthenticated` firing after `documentName` already
  // changed and a new provider was created) ever updating state for a provider this hook has moved on
  // from.
  const currentDocumentName = useRef<string | null>(null);

  useEffect(() => {
    if (!documentName) {
      setProvider(null);
      return;
    }
    currentDocumentName.current = documentName;
    setState({ status: 'connecting', synced: false, scope: null, presence: [] });

    const instance = new HocuspocusProvider({
      url: collabWebsocketUrl(),
      name: documentName,
      document: new Y.Doc({ gc: false }),
    });

    const isStale = () => currentDocumentName.current !== documentName;

    const updatePresence = () => {
      if (isStale()) return;
      setState((prev) => ({ ...prev, presence: readPresence(instance) }));
    };

    instance.on('status', ({ status }: { status: CollabConnectionStatus }) => {
      if (isStale()) return;
      setState((prev) => ({ ...prev, status }));
    });
    instance.on('synced', () => {
      if (isStale()) return;
      setState((prev) => ({ ...prev, synced: true }));
    });
    instance.on('authenticated', ({ scope }: { scope: CollabAuthorizedScope }) => {
      if (isStale()) return;
      setState((prev) => ({ ...prev, scope }));
    });
    instance.awareness?.on('change', updatePresence);

    setProvider(instance);

    return () => {
      currentDocumentName.current = null;
      instance.awareness?.off('change', updatePresence);
      instance.destroy();
    };
  }, [documentName]);

  return { provider, state };
}
