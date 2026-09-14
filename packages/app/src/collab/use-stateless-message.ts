/**
 * Reacts to a specific server -> client stateless message type (SDD-008: `blame:stale`,
 * `validation:updated`, `comment:updated`, ...) on the shared `HocuspocusProvider`. The stateless channel
 * is server-only (WO-151: a client-sent stateless message is always rejected), so this hook only ever
 * needs to *listen*, never send.
 */
import { useEffect, useRef } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';

interface StatelessEnvelope {
  type?: unknown;
}

function parseStatelessType(payload: string): string | null {
  try {
    const parsed: StatelessEnvelope = JSON.parse(payload);
    return typeof parsed.type === 'string' ? parsed.type : null;
  } catch {
    return null; // malformed/foreign payload — never crash the listener over it
  }
}

/** `onMessage` doesn't need to be memoized by the caller — the latest one is always used, without
 * re-subscribing to the provider on every render. */
export function useStatelessMessage(provider: HocuspocusProvider | null, type: string, onMessage: () => void): void {
  const latestOnMessage = useRef(onMessage);
  latestOnMessage.current = onMessage;

  useEffect(() => {
    if (!provider) return;
    const handler = ({ payload }: { payload: string }) => {
      if (parseStatelessType(payload) === type) latestOnMessage.current();
    };
    provider.on('stateless', handler);
    return () => {
      provider.off('stateless', handler);
    };
  }, [provider, type]);
}
