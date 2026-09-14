import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import { checkUpdateAgainstBindings } from '../../src/anti-spoofing.js';
import { decodeUpdateRanges } from '../../src/update-ranges.js';

const noBinding = () => undefined;

describe('checkUpdateAgainstBindings (pure numeric ranges)', () => {
  test('accepts a brand-new client id with no binding yet', () => {
    const result = checkUpdateAgainstBindings({
      structRanges: [{ client: 1, from: 0, to: 5 }],
      deleteRanges: [],
      serverStateVector: new Map(),
      lookupBinding: noBinding,
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(true);
  });

  test('accepts a client id bound to the same user', () => {
    const result = checkUpdateAgainstBindings({
      structRanges: [{ client: 1, from: 5, to: 10 }],
      deleteRanges: [],
      serverStateVector: new Map([[1, 5]]),
      lookupBinding: () => 'user-a',
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(true);
  });

  test('rejects new content from a client id bound to a different user', () => {
    const result = checkUpdateAgainstBindings({
      structRanges: [{ client: 1, from: 5, to: 10 }],
      deleteRanges: [],
      serverStateVector: new Map([[1, 5]]),
      lookupBinding: () => 'user-b',
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bound to a different user/);
  });

  test('allows an honest resend of already-contained structs even if bound to a different user (e.g. after a server restart)', () => {
    const result = checkUpdateAgainstBindings({
      structRanges: [{ client: 1, from: 0, to: 5 }],
      deleteRanges: [],
      serverStateVector: new Map([[1, 5]]),
      lookupBinding: () => 'user-b',
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(true);
  });

  test('rejects an update whose struct range starts beyond the server state vector (missing dependency)', () => {
    const result = checkUpdateAgainstBindings({
      structRanges: [{ client: 1, from: 10, to: 15 }],
      deleteRanges: [],
      serverStateVector: new Map([[1, 5]]),
      lookupBinding: noBinding,
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing dependency/);
  });

  test('rejects a delete set referencing clocks the server does not have', () => {
    const result = checkUpdateAgainstBindings({
      structRanges: [],
      deleteRanges: [{ client: 1, clock: 3, len: 5 }],
      serverStateVector: new Map([[1, 5]]),
      lookupBinding: noBinding,
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/delete set/);
  });

  test('accepts a delete set fully within the known state vector', () => {
    const result = checkUpdateAgainstBindings({
      structRanges: [],
      deleteRanges: [{ client: 1, clock: 0, len: 5 }],
      serverStateVector: new Map([[1, 5]]),
      lookupBinding: noBinding,
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(true);
  });

  test('rejects if any one of several struct ranges fails, even when earlier ones pass', () => {
    const result = checkUpdateAgainstBindings({
      structRanges: [
        { client: 1, from: 0, to: 5 },
        { client: 2, from: 0, to: 5 },
      ],
      deleteRanges: [],
      serverStateVector: new Map([
        [1, 5],
        [2, 0],
      ]),
      lookupBinding: (client) => (client === 2 ? 'user-b' : undefined),
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/client 2/);
  });
});

describe('checkUpdateAgainstBindings (real Yjs updates)', () => {
  test('a legitimate new client writing fresh content passes', () => {
    const server = new Y.Doc({ gc: false });
    const client = new Y.Doc({ gc: false });
    client.getText('body').insert(0, 'hello');
    const update = Y.encodeStateAsUpdate(client);

    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    const serverStateVector = Y.decodeStateVector(Y.encodeStateVector(server));

    const result = checkUpdateAgainstBindings({
      structRanges,
      deleteRanges,
      serverStateVector,
      lookupBinding: noBinding,
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(true);
  });

  test('a reconnecting honest client resending already-applied history passes even under another user\'s connection', () => {
    const server = new Y.Doc({ gc: false });
    const client = new Y.Doc({ gc: false });
    client.getText('body').insert(0, 'hello');
    const update = Y.encodeStateAsUpdate(client);
    Y.applyUpdate(server, update);

    // The same client resends the exact same (now fully-known) update, e.g. after a reconnect.
    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    const serverStateVector = Y.decodeStateVector(Y.encodeStateVector(server));

    const result = checkUpdateAgainstBindings({
      structRanges,
      deleteRanges,
      serverStateVector,
      lookupBinding: () => 'some-other-user-id',
      connectionUserId: 'user-a',
    });
    expect(result.ok).toBe(true);
  });

  test('a malicious client forging another user\'s already-bound client id with new content is rejected', () => {
    const server = new Y.Doc({ gc: false });
    const legitClient = new Y.Doc({ gc: false });
    legitClient.getText('body').insert(0, 'legit');
    Y.applyUpdate(server, Y.encodeStateAsUpdate(legitClient));

    // The attacker continues writing under the *same* clientID (simulating a forged/reused client id).
    legitClient.getText('body').insert(5, ' forged');
    const forgedUpdate = Y.encodeStateAsUpdate(legitClient, Y.encodeStateVector(server));

    const { structRanges, deleteRanges } = decodeUpdateRanges(forgedUpdate);
    const serverStateVector = Y.decodeStateVector(Y.encodeStateVector(server));

    const result = checkUpdateAgainstBindings({
      structRanges,
      deleteRanges,
      serverStateVector,
      lookupBinding: () => 'the-legit-user',
      connectionUserId: 'attacker',
    });
    expect(result.ok).toBe(false);
  });
});
