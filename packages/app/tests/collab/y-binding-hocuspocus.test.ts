/**
 * WO-375 — confirms `applySplice`'s `PREVIEW_ORIGIN` is never mistaken by `HocuspocusProvider` for its
 * own echoed origin (`documentUpdateHandler` in `@hocuspocus/provider` drops any local update whose
 * transaction origin `=== this` provider instance — see its own source, `if (origin === this) return`).
 * Since `PREVIEW_ORIGIN` is a module-level `Symbol`, it can never equal a provider instance, but this test
 * proves the edit actually reaches a real embedded Hocuspocus server end to end rather than trusting that
 * reasoning alone. Harness mirrors `packages/app/tests/collab/two-provider.test.ts` (WO-159) exactly.
 */
import fastifyWebsocket from '@fastify/websocket';
import { Hocuspocus } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import Fastify, { type FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { afterEach, describe, expect, test } from 'vitest';
import { applySplice } from '../../src/editor/y-binding.js';

interface Harness {
  app: FastifyInstance;
  url: string;
}

async function startHarness(): Promise<Harness> {
  const hocuspocus = new Hocuspocus({ yDocOptions: { gc: false, gcFilter: () => true } });

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

function makeProvider(url: string, name: string): HocuspocusProvider {
  const config: object = { url, name, document: new Y.Doc({ gc: false }), WebSocketPolyfill: WebSocket };
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

describe('applySplice over a real HocuspocusProvider (WO-375)', () => {
  let harness: Harness | undefined;
  const providers: HocuspocusProvider[] = [];

  afterEach(async () => {
    for (const provider of providers.splice(0)) provider.destroy();
    if (harness) {
      await harness.app.close();
      harness = undefined;
    }
  });

  test('a PREVIEW_ORIGIN edit is sent to the server and reaches another connected client', async () => {
    harness = await startHarness();
    const editor = makeProvider(harness.url, 'doc-preview');
    providers.push(editor);
    await onceSynced(editor);

    const ytext = editor.document.getText('body');
    ytext.insert(0, 'hello world');
    await onceUnsyncedChangesSettled(editor);

    expect(editor.hasUnsyncedChanges).toBe(false);
    applySplice(ytext, { from: 6, to: 11, insert: 'there' });
    // documentUpdateHandler only drops an update whose origin is the provider instance itself; a real
    // network round trip (not merely a synchronous check) is the only way to prove PREVIEW_ORIGIN didn't
    // trigger that same drop.
    expect(editor.hasUnsyncedChanges).toBe(true);
    await onceUnsyncedChangesSettled(editor);

    const observer = makeProvider(harness.url, 'doc-preview');
    providers.push(observer);
    await onceSynced(observer);

    expect(observer.document.getText('body').toString()).toBe('hello there');
  });
});
