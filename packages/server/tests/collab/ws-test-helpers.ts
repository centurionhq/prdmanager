/**
 * Shared real-`ws`/`HocuspocusProvider` test helpers (SDD-008), factored out of WO-146's own
 * `authenticate.test.ts` so WO-147's isolation cases (`../isolation/collab-document-name.test.ts`) and
 * later WOs (148-152) don't each reimplement the same header-injecting polyfill and event-waiting
 * promises. Every wait is on a real provider event, never a timer.
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import WebSocket from 'ws';

/** `@hocuspocus/provider` only ever calls `new this.configuration.WebSocketPolyfill(url)` (no headers
 * argument) — this subclass injects fixed headers (cookie/origin) into `ws`'s own 3-argument
 * constructor so tests can simulate a real authenticated browser upgrade. */
export function headeredWebSocketPolyfill(headers: Record<string, string>): typeof WebSocket {
  return class extends WebSocket {
    constructor(address: string | URL) {
      super(address, [], { headers });
    }
  } as unknown as typeof WebSocket;
}

export function makeCollabProvider(url: string, documentName: string, headers: Record<string, string>): HocuspocusProvider {
  const config: object = { url, name: documentName, document: new Y.Doc({ gc: false }), WebSocketPolyfill: headeredWebSocketPolyfill(headers) };
  return new HocuspocusProvider(config as ConstructorParameters<typeof HocuspocusProvider>[0]);
}

export function onceSynced(provider: HocuspocusProvider): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('synced', handler);
      resolve();
    };
    provider.on('synced', handler);
  });
}

export function onceAuthenticationFailed(provider: HocuspocusProvider): Promise<{ reason: string }> {
  return new Promise((resolve) => {
    const handler = (data: { reason: string }) => {
      provider.off('authenticationFailed', handler);
      resolve(data);
    };
    provider.on('authenticationFailed', handler);
  });
}
