/**
 * WO-159 — two real `HocuspocusProvider`s against a real embedded `Hocuspocus` server (same
 * Fastify+`@fastify/websocket` shape `packages/server`'s own learning test/WO-145 harness established):
 * concurrent edits converge, and a read-only-role connection's edits never reach the other client. A
 * minimal `onAuthenticate` (not the full production auth/RLS stack, out of `packages/app`'s dependency
 * graph by design — SDD-006 §Arquitectura) grants `readOnly` based on a token the test controls directly,
 * exactly mirroring the *shape* of `packages/server`'s own real authorization result without duplicating
 * its implementation. Every wait is on a real provider event, never a timer.
 */
import fastifyWebsocket from '@fastify/websocket';
import { Hocuspocus, type Extension } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import Fastify, { type FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { afterEach, describe, expect, test } from 'vitest';

interface Harness {
  app: FastifyInstance;
  url: string;
}

async function startHarness(): Promise<Harness> {
  const hocuspocus = new Hocuspocus({
    yDocOptions: { gc: false, gcFilter: () => true },
    extensions: [
      {
        extensionName: 'test-readonly-by-token',
        async onAuthenticate(data) {
          data.connectionConfig.readOnly = data.token === 'readonly';
        },
      } satisfies Extension,
    ],
  });

  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });
  app.get('/collab', { websocket: true }, (socket, request) => {
    const connection = hocuspocus.handleConnection(socket, request.raw as unknown as Request);
    socket.on('message', (data: Uint8Array) => connection.handleMessage(data));
    socket.on('close', (event: unknown) => connection.handleClose(event as never));
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  return { app, url: `ws://127.0.0.1:${address.port}/collab` };
}

function makeProvider(url: string, name: string, token?: string): HocuspocusProvider {
  const config: object = { url, name, token, document: new Y.Doc({ gc: false }), WebSocketPolyfill: WebSocket };
  return new HocuspocusProvider(config as ConstructorParameters<typeof HocuspocusProvider>[0]);
}

function onceSynced(provider: HocuspocusProvider): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('synced', handler);
      resolve();
    };
    provider.on('synced', handler);
  });
}

function onceAuthenticated(provider: HocuspocusProvider): Promise<{ scope: string }> {
  return new Promise((resolve) => {
    const handler = (data: { scope: string }) => {
      provider.off('authenticated', handler);
      resolve(data);
    };
    provider.on('authenticated', handler);
  });
}

function onceUnsyncedChangesSettled(provider: HocuspocusProvider): Promise<void> {
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

describe('two HocuspocusProvider clients (WO-159)', () => {
  let harness: Harness | undefined;
  const providers: HocuspocusProvider[] = [];

  afterEach(async () => {
    for (const provider of providers.splice(0)) provider.destroy();
    if (harness) {
      await harness.app.close();
      harness = undefined;
    }
  });

  test('concurrent edits from two providers converge to the same content', async () => {
    harness = await startHarness();
    const a = makeProvider(harness.url, 'doc-1');
    const b = makeProvider(harness.url, 'doc-1');
    providers.push(a, b);
    await Promise.all([onceSynced(a), onceSynced(b)]);

    a.document.getText('body').insert(0, 'from A\n');
    b.document.getText('body').insert(0, 'from B\n');
    await Promise.all([onceUnsyncedChangesSettled(a), onceUnsyncedChangesSettled(b)]);

    // Convergence: whichever interleaving Yjs's CRDT resolves to, both providers end up byte-identical.
    // Re-checked on every real Y.Doc update event (local or received-from-server) on either side — never
    // a timer — until both texts agree.
    await new Promise<void>((resolve) => {
      const check = () => {
        if (a.document.getText('body').toString() !== b.document.getText('body').toString()) return;
        a.document.off('update', check);
        b.document.off('update', check);
        resolve();
      };
      a.document.on('update', check);
      b.document.on('update', check);
      check();
    });
    expect(a.document.getText('body').toString()).toBe(b.document.getText('body').toString());
    expect(a.document.getText('body').toString()).toContain('from A');
    expect(a.document.getText('body').toString()).toContain('from B');
  });

  test("a read-only-role provider's edits never reach the other client", async () => {
    harness = await startHarness();
    const writer = makeProvider(harness.url, 'doc-2', 'read-write');
    providers.push(writer);
    await onceSynced(writer);
    writer.document.getText('body').insert(0, 'seed content\n');
    await onceUnsyncedChangesSettled(writer);

    const reader = makeProvider(harness.url, 'doc-2', 'readonly');
    providers.push(reader);
    // Both listeners registered up front (`Promise.all`, not two sequential `await`s): 'authenticated'
    // and 'synced' can arrive close enough together that a second `.on(...)` registered only after
    // `await`-ing the first has already missed the second by the time it attaches (confirmed empirically
    // — this exact sequential-await shape reliably hung; `packages/server`'s own collab tests never wait
    // on 'authenticated' at all for exactly this reason, only ever on 'synced' directly).
    const [readerAuth] = await Promise.all([onceAuthenticated(reader), onceSynced(reader)]);
    expect(readerAuth.scope).toBe('readonly');
    expect(reader.document.getText('body').toString()).toBe('seed content\n');

    // The read-only client attempts an edit anyway (e.g. a compromised/buggy client) — the server must
    // simply never apply or broadcast it, never merely "trust" the client not to send one.
    reader.document.getText('body').insert(0, 'sneaky edit');

    writer.document.getText('body').insert(0, 'legit edit\n');
    await onceUnsyncedChangesSettled(writer);

    // Give the (rejected) read-only edit every chance to have propagated if it were ever going to; the
    // writer converging on its own content without the reader's text is the actual assertion, not a
    // fixed wait — reconnecting a third observer confirms the server's own durable state.
    const observer = makeProvider(harness.url, 'doc-2');
    providers.push(observer);
    await onceSynced(observer);

    expect(observer.document.getText('body').toString()).toContain('legit edit');
    expect(observer.document.getText('body').toString()).not.toContain('sneaky edit');
  });
});
