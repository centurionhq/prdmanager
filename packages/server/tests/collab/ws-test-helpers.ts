/**
 * Shared real-`ws`/`HocuspocusProvider` test helpers (SDD-008), factored out of WO-146's own
 * `authenticate.test.ts` so WO-147's isolation cases (`../isolation/collab-document-name.test.ts`) and
 * later WOs (148-152) don't each reimplement the same header-injecting polyfill and event-waiting
 * promises. Every wait is on a real provider event, never a timer.
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { buildServer, type BuildServerDeps } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { ISOLATION_TEST_ENV } from '../isolation/fixtures.js';

type BuiltApp = ReturnType<typeof buildServer>;

/** Real Fastify server + `/collab` on an OS-assigned port, for every collab integration test. Always
 * sets Hocuspocus's own `debounce`/`maxDebounce` to `0` (unrelated to WO-149's own ≤50ms `doc_updates`
 * batch window) so a test's `onStoreDocument` snapshot fires — and finishes — before the test's own
 * pool closes, rather than on a real timer `register-collab-route.js`'s own doc comment explains. */
export async function startCollabApp(deps: Partial<BuildServerDeps>): Promise<{ app: BuiltApp; url: string }> {
  const app = buildServer({
    env: ISOLATION_TEST_ENV,
    mailer: new FakeMailer(),
    logger: false,
    collabPersistDebounce: { debounce: 0, maxDebounce: 0 },
    ...deps,
  });
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  return { app, url: `ws://127.0.0.1:${address.port}/collab` };
}

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

/**
 * Resolves once the server has fully processed (applied and acked, via a `SyncStatus` message) every
 * update this provider has sent so far — the client-observable proxy for "the server's `beforeSync`
 * hook chain, including WO-149's durable write, has already completed for this edit". Event-driven
 * (the provider's own `unsyncedChanges` event), never a timer.
 */
export function onceUnsyncedChangesSettled(provider: HocuspocusProvider): Promise<void> {
  if (!provider.hasUnsyncedChanges) return Promise.resolve();
  return new Promise((resolve) => {
    const handler = ({ number }: { number: number }) => {
      if (number === 0) {
        provider.off('unsyncedChanges', handler);
        resolve();
      }
    };
    provider.on('unsyncedChanges', handler);
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
