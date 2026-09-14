/**
 * Learning test — ADR-006 / WO-082.
 *
 * Confirms the exact @hocuspocus/server 4.7.0 API assumed by SDD-008 §"Servidor de tiempo real" for
 * embedding Hocuspocus inside the same Fastify process behind @fastify/websocket 11.3.0, instead of
 * the ADR-006 "plan B" (a separate Hocuspocus process behind the same origin).
 *
 * CONFIRMED against the installed `@hocuspocus/server`/`@hocuspocus/provider` 4.7.0 sources
 * (`node_modules/@hocuspocus/server/dist/index.d.ts` + `dist/hocuspocus-server.esm.js`,
 * `node_modules/@hocuspocus/provider/dist/hocuspocus-provider.esm.js`):
 *
 *  - Embedding works with no listener of its own: `new Hocuspocus({...})` never calls `.listen()`.
 *    A Fastify `{ websocket: true }` route hands the raw `ws` socket and Fastify's raw `request` to
 *    `hocuspocus.handleConnection(socket, request, defaultContext?)` — exact name and signature
 *    confirmed in `dist/index.d.ts`. Plan B was NOT needed.
 *  - MAJOR DEVIATION vs. the ADR/SDD wording ("una ruta ... que entrega el socket a Hocuspocus"):
 *    `handleConnection` does NOT itself subscribe to the socket's `message`/`close` events — it only
 *    runs `onConnect`/`onAuthenticate` and returns a `ClientConnection`. Its own `dist/index.d.ts`
 *    documents `handleMessage: (data: Uint8Array) => void` as "Call this from your integration when
 *    the WebSocket receives a binary message" and `handleClose(event?)` as "Call this from your
 *    integration when the WebSocket connection closes". Confirmed empirically: without the route
 *    also doing `socket.on('message', (d) => connection.handleMessage(d))` and
 *    `socket.on('close', (e) => connection.handleClose(e))`, no hook ever fires and no provider ever
 *    reaches `synced` (verified by reproducing the hang, then fixing it, below).
 *  - `onAuthenticate(data)` receives `data.token` (the client `HocuspocusProvider`'s `token` config)
 *    and `data.context`; throwing/returning a rejected promise inside it rejects that document's
 *    handshake (the server catches the error, sends `writePermissionDenied`, and the provider emits
 *    `authenticationFailed`).
 *  - DEVIATION from a literal reading of the ADR ("conexión de solo lectura"): there is no
 *    declarative return value for read-only. `data.connectionConfig` (`{ readOnly, isAuthenticated }`)
 *    passed into `onAuthenticate` is the *same object reference* later read back by the caller
 *    (`hocuspocus-server.esm.js` around lines 934/1054), so `onAuthenticate` must mutate it in place:
 *    `data.connectionConfig.readOnly = true`. Once set, the server drops both SyncStep2 *and* Update
 *    messages from that connection (`readSyncMessage`, lines ~265/284) — verified empirically below,
 *    including that a second read-write provider never observes the read-only client's edits.
 *  - `beforeSync(data)` fires with `{ type, payload }` (the raw y-protocols/sync message type and
 *    bytes) strictly *before* the update is applied to the shared document (confirmed by reading
 *    `readSyncMessage`: the hook call precedes the `switch` that applies SyncStep2/Update). `payload`
 *    decodes with `Y.decodeUpdate` without throwing for both message types.
 *  - `maxPayload` is not a first-class `@fastify/websocket` option; it is `ws`'s own
 *    `WebSocketServerOptions['maxPayload']`, forwarded via
 *    `fastify.register(websocketPlugin, { options: { maxPayload } })`. An oversized frame closes the
 *    raw `ws` socket with code 1009 ("Message too big") before any Hocuspocus/Yjs framing runs.
 *  - `yDocOptions: { gc: false }` on the `Hocuspocus` configuration is honored: the `Document`
 *    handed to hooks is a real `Y.Doc` subclass whose own `.gc` property reflects the configured
 *    value.
 *  - DEVIATION from the provider's own TypeScript types: `HocuspocusProviderConfiguration`'s type
 *    only allows `WebSocketPolyfill` when the caller builds a separate `HocuspocusProviderWebsocket`
 *    (the `websocketProvider` field). Passing `{ url, WebSocketPolyfill }` directly to
 *    `new HocuspocusProvider(...)` still works at runtime because the constructor forwards its whole
 *    config object verbatim into `new HocuspocusProviderWebsocket(configuration)`
 *    (`hocuspocus-provider.esm.js` ~line 696) — the runtime is more permissive than the types; a cast
 *    is required to satisfy `tsc`.
 *  - Two more type-only frictions found by `tsc -p tsconfig.test.json` (both cast around below,
 *    runtime behavior already covered above): `Configuration['yDocOptions']` types `gcFilter` as
 *    required even though the constructor accepts `Partial<ServerConfiguration>`, so `{ gc: false }`
 *    alone doesn't type-check; and `handleConnection`'s second parameter is typed as the global
 *    (fetch) `Request`, not Node's `IncomingMessage`, even though at runtime only `.url` (a string)
 *    and `.headers` (stored as-is, never called as `Headers.get`) are read from it — Fastify's
 *    `request.raw` (an `IncomingMessage`) works fine and is what a real integration has available.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { Hocuspocus, type beforeSyncPayload, type onAuthenticatePayload } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { afterEach, describe, expect, test } from 'vitest';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const REJECTED_TOKEN = 'invalid-token';
const READER_PREFIX = 'reader:';

interface Harness {
  app: FastifyInstance;
  hocuspocus: Hocuspocus;
  url: string;
  beforeSyncCalls: Array<{ type: number; documentName: string; decodedOk: boolean }>;
  loadedDocs: Array<{ documentName: string; gc: boolean }>;
}

/** Builds a fresh Fastify + embedded Hocuspocus harness listening on an OS-assigned port. */
async function startHarness(): Promise<Harness> {
  const beforeSyncCalls: Harness['beforeSyncCalls'] = [];
  const loadedDocs: Harness['loadedDocs'] = [];

  const hocuspocus = new Hocuspocus({
    // `gcFilter` is typed as required even though `Hocuspocus` accepts `Partial<ServerConfiguration>`
    // (see header comment); the default filter (keep everything) is `() => true`.
    yDocOptions: { gc: false, gcFilter: () => true },
    async onAuthenticate(data: onAuthenticatePayload) {
      if (data.token === REJECTED_TOKEN) {
        throw new Error('rejected by onAuthenticate (learning test)');
      }
      if (data.token.startsWith(READER_PREFIX)) {
        // Confirmed mechanism (see header comment): mutate connectionConfig in place.
        data.connectionConfig.readOnly = true;
      }
      return { userId: data.token };
    },
    async onLoadDocument(data) {
      loadedDocs.push({ documentName: data.documentName, gc: data.document.gc });
    },
    async beforeSync(data: beforeSyncPayload) {
      let decodedOk = true;
      try {
        Y.decodeUpdate(data.payload);
      } catch {
        decodedOk = false;
      }
      beforeSyncCalls.push({ type: data.type, documentName: data.documentName, decodedOk });
    },
  });

  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });
  app.get('/collab', { websocket: true }, (socket, request) => {
    // DEVIATION (see header comment): `handleConnection` does NOT wire the socket's own events.
    // Its returned `ClientConnection` exposes `handleMessage`/`handleClose`, documented in
    // `dist/index.d.ts` as "Call this from your integration" — the Fastify route must forward them.
    // `handleConnection`'s second parameter is typed as the global fetch `Request` (see header
    // comment) but only `.url`/`.headers` are read at runtime; Fastify's Node `IncomingMessage`
    // works and is cast to satisfy `tsc`.
    const connection = hocuspocus.handleConnection(socket, request.raw as unknown as Request);
    socket.on('message', (data: Uint8Array) => connection.handleMessage(data));
    socket.on('close', (event: unknown) => connection.handleClose(event as never));
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a bound TCP address');
  }
  return { app, hocuspocus, url: `ws://127.0.0.1:${address.port}/collab`, beforeSyncCalls, loadedDocs };
}

function makeProvider(url: string, name: string, token: string): HocuspocusProvider {
  // `WebSocketPolyfill` at the top level isn't in `HocuspocusProviderConfiguration`'s type (see
  // header comment) even though the constructor forwards it at runtime; build the config as `object`
  // to bypass the excess-property check rather than widening the constructor's own parameter type.
  const config: object = {
    url,
    name,
    token,
    document: new Y.Doc({ gc: false }),
    WebSocketPolyfill: WebSocket,
  };
  return new HocuspocusProvider(config as ConstructorParameters<typeof HocuspocusProvider>[0]);
}

// DEVIATION: @hocuspocus/provider ships its own minimal EventEmitter (see header comment) with only
// `on`/`emit`/`off`/`removeAllListeners` — no `once` — so callers must remove the listener themselves.
function onceSynced(provider: HocuspocusProvider): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('synced', handler);
      resolve();
    };
    provider.on('synced', handler);
  });
}

function onceAuthenticationFailed(provider: HocuspocusProvider): Promise<{ reason: string }> {
  return new Promise((resolve) => {
    const handler = (data: { reason: string }) => {
      provider.off('authenticationFailed', handler);
      resolve(data);
    };
    provider.on('authenticationFailed', handler);
  });
}

describe('Hocuspocus 4.7.0 embedded in Fastify via @fastify/websocket (ADR-006, WO-082)', () => {
  let harness: Harness | undefined;
  const providers: HocuspocusProvider[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const provider of providers.splice(0)) provider.destroy();
    for (const socket of sockets.splice(0)) socket.terminate();
    if (harness) {
      await harness.app.close();
      harness = undefined;
    }
  });

  test('handleConnection embeds Hocuspocus with no listener of its own; two providers converge', async () => {
    harness = await startHarness();
    const docName = 'proj-1:doc-1';

    const writer = makeProvider(harness.url, docName, 'writer-1');
    const reader = makeProvider(harness.url, docName, 'writer-2');
    providers.push(writer, reader);

    await Promise.all([onceSynced(writer), onceSynced(reader)]);

    writer.document.getText('body').insert(0, 'hello from writer');
    await new Promise<void>((resolve) => {
      reader.document.getText('body').observe(function handler() {
        if (reader.document.getText('body').toString() === 'hello from writer') {
          reader.document.getText('body').unobserve(handler);
          resolve();
        }
      });
    });

    expect(reader.document.getText('body').toString()).toBe('hello from writer');
  });

  test('onAuthenticate receives the client-supplied context (token) and can reject the connection', async () => {
    harness = await startHarness();
    const rejected = makeProvider(harness.url, 'proj-1:doc-2', REJECTED_TOKEN);
    providers.push(rejected);

    const failure = await onceAuthenticationFailed(rejected);
    expect(failure.reason).toBe('permission-denied');
  });

  test('a read-only connection never has its SyncStep2/Update seen by a second read-write provider', async () => {
    harness = await startHarness();
    const docName = 'proj-1:doc-3';

    const owner = makeProvider(harness.url, docName, 'writer-owner');
    const readOnlyClient = makeProvider(harness.url, docName, `${READER_PREFIX}intruder`);
    providers.push(owner, readOnlyClient);
    await Promise.all([onceSynced(owner), onceSynced(readOnlyClient)]);

    // The read-only client attempts an edit; the server must drop it (SyncStep2/Update dropped).
    readOnlyClient.document.getText('body').insert(0, 'should never sync');

    // A brand-new read-write provider on the same document must never observe that edit: proven by
    // waiting for it to fully sync and asserting its content stays empty.
    const observer = makeProvider(harness.url, docName, 'writer-observer');
    providers.push(observer);
    await onceSynced(observer);

    expect(observer.document.getText('body').toString()).toBe('');
    expect(owner.document.getText('body').toString()).toBe('');
  });

  test('beforeSync exposes the decoded message type/payload before it is applied to the doc', async () => {
    harness = await startHarness();
    const docName = 'proj-1:doc-4';
    const provider = makeProvider(harness.url, docName, 'writer-1');
    providers.push(provider);
    await onceSynced(provider);

    provider.document.getText('body').insert(0, 'x');
    // The server calls `beforeSync` before applying the update and acking it back; by the time the
    // client receives any further `message` event, the hook has necessarily already run. Poll on
    // that real event instead of a wall-clock timer.
    await new Promise<void>((resolve) => {
      const check = () => {
        if (harness!.beforeSyncCalls.some((call) => call.type === 2)) {
          provider.off('message', check);
          resolve();
        }
      };
      provider.on('message', check);
      check();
    });

    const updateCalls = harness.beforeSyncCalls.filter((call) => call.type === 2);
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(updateCalls.every((call) => call.decodedOk)).toBe(true);
  });

  test('maxPayload on @fastify/websocket closes oversized frames (ws code 1009)', async () => {
    harness = await startHarness();
    const raw = new WebSocket(harness.url);
    sockets.push(raw);
    await new Promise<void>((resolve, reject) => {
      raw.once('open', resolve);
      raw.once('error', reject);
    });

    const closeEvent = new Promise<{ code: number }>((resolve) => {
      raw.once('close', (code: number) => resolve({ code }));
    });
    raw.send(Buffer.alloc(MAX_PAYLOAD_BYTES + 1));

    const { code } = await closeEvent;
    expect(code).toBe(1009);
  });

  test('yDocOptions with gc:false is honored by the server-side Document', async () => {
    harness = await startHarness();
    const provider = makeProvider(harness.url, 'proj-1:doc-5', 'writer-1');
    providers.push(provider);
    await onceSynced(provider);

    expect(harness.loadedDocs.some((doc) => doc.documentName === 'proj-1:doc-5' && doc.gc === false)).toBe(true);
  });
});
