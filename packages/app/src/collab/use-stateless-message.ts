/**
 * Reacts to a specific server -> client stateless message type (SDD-008: `blame:stale`,
 * `validation:updated`, `comment:updated`, ...) on the shared `HocuspocusProvider`. The stateless channel
 * is server-only (WO-151: a client-sent stateless message is always rejected), so this hook only ever
 * needs to *listen*, never send.
 */
import { useEffect, useRef } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';

interface StatelessEnvelope {
  type: string;
  [key: string]: unknown;
}

function parseStateless(payload: string): StatelessEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const envelope = parsed as { type?: unknown; [key: string]: unknown };
    return typeof envelope.type === 'string' ? (envelope as StatelessEnvelope) : null;
  } catch {
    return null; // malformed/foreign payload — never crash the listener over it
  }
}

/** `onMessage` receives the full parsed envelope (e.g. `validation:updated`'s own `issues` array) — a
 * caller that only cares "did this fire" can just ignore the argument. Doesn't need to be memoized by the
 * caller either way: the latest one is always used, without re-subscribing to the provider on every
 * render. */
export function useStatelessMessage<T extends { type: string } = StatelessEnvelope>(provider: HocuspocusProvider | null, type: string, onMessage: (payload: T) => void): void {
  const latestOnMessage = useRef(onMessage);
  latestOnMessage.current = onMessage;

  useEffect(() => {
    if (!provider) return;
    const handler = ({ payload }: { payload: string }) => {
      const envelope = parseStateless(payload);
      if (envelope?.type === type) latestOnMessage.current(envelope as T);
    };
    provider.on('stateless', handler);
    return () => {
      provider.off('stateless', handler);
    };
  }, [provider, type]);
}
