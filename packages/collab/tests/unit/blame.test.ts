import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import { computeBlame, buildRangeIndex, type RangeIndexRow } from '../../src/blame.js';
import { decodeUpdateRanges } from '../../src/update-ranges.js';
import { BODY_ROOT, FRONTMATTER_ROOT } from '../../src/schema.js';

/** Applies `mutate` to `ydoc` and returns the resulting `RangeIndexRow`, as if this were exactly one
 * `doc_updates` row durably written for it (mirrors `packages/server/src/collab/attribution.ts`'s own
 * shape, minus the database-only `connectionId`). `ydoc` is mutated in place, same as the real server
 * applying an incoming update before logging it. */
function recordRow(
  ydoc: Y.Doc,
  mutate: () => void,
  actor: Pick<RangeIndexRow, 'actorKind' | 'userId' | 'onBehalfOf' | 'agentId'>,
  receivedAt: string,
): RangeIndexRow {
  const before = Y.encodeStateVector(ydoc);
  mutate();
  const update = Y.encodeStateAsUpdate(ydoc, before);
  const { structRanges, deleteRanges } = decodeUpdateRanges(update);
  return { structRanges, deleteRanges, receivedAt, ...actor };
}

const USER = (userId: string) => ({ actorKind: 'user' as const, userId, onBehalfOf: null, agentId: null });
const SYSTEM_ON_BEHALF_OF = (userId: string) => ({ actorKind: 'system' as const, userId: null, onBehalfOf: userId, agentId: null });
const AGENT_ON_BEHALF_OF = (agentId: string, userId: string) => ({ actorKind: 'agent' as const, userId: null, onBehalfOf: userId, agentId });

function newDoc(): Y.Doc {
  const ydoc = new Y.Doc({ gc: false });
  ydoc.getMap(FRONTMATTER_ROOT);
  ydoc.getText(BODY_ROOT);
  return ydoc;
}

describe('computeBlame', () => {
  test('plain insert: a single line is attributed to whoever inserted it', () => {
    const ydoc = newDoc();
    const row = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).insert(0, 'hello'), USER('alice'), '2026-01-01T00:00:00.000Z');

    const { lines } = computeBlame(ydoc, buildRangeIndex([row]));

    expect(lines).toEqual([{ line: 0, attribution: { actorKind: 'user', userId: 'alice', onBehalfOf: null, agentId: null, receivedAt: '2026-01-01T00:00:00.000Z' } }]);
  });

  test('two lines from two different authors are attributed independently', () => {
    // Two distinct client ids (never the same shared Y.Doc a real two-user scenario never has), synced
    // sequentially (not concurrently) so Yjs has no ambiguous ordering to resolve: alice's line lands
    // first, bob's second, deterministically.
    const server = newDoc();
    const alice = newDoc();
    const aliceBefore = Y.encodeStateVector(alice);
    alice.getText(BODY_ROOT).insert(0, 'first line\n');
    const updateAlice = Y.encodeStateAsUpdate(alice, aliceBefore);
    Y.applyUpdate(server, updateAlice);
    const rowAlice: RangeIndexRow = { ...decodeUpdateRanges(updateAlice), ...USER('alice'), receivedAt: '2026-01-01T00:00:00.000Z' };

    const bob = newDoc();
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(server));
    const bobBefore = Y.encodeStateVector(bob);
    bob.getText(BODY_ROOT).insert(bob.getText(BODY_ROOT).length, 'second line');
    const updateBob = Y.encodeStateAsUpdate(bob, bobBefore);
    Y.applyUpdate(server, updateBob);
    const rowBob: RangeIndexRow = { ...decodeUpdateRanges(updateBob), ...USER('bob'), receivedAt: '2026-01-01T00:01:00.000Z' };

    const { lines } = computeBlame(server, buildRangeIndex([rowAlice, rowBob]));

    expect(server.getText(BODY_ROOT).toString()).toBe('first line\nsecond line');
    expect(lines.map((l) => l.attribution?.userId)).toEqual(['alice', 'bob']);
  });

  test('delete: deleting part of a line attributes it to the deleter when more recent than the insert', () => {
    const ydoc = newDoc();
    const row1 = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).insert(0, 'hello world'), USER('alice'), '2026-01-01T00:00:00.000Z');
    const row2 = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).delete(5, 6), USER('bob'), '2026-01-01T00:05:00.000Z');

    const { lines } = computeBlame(ydoc, buildRangeIndex([row1, row2]));

    expect(ydoc.getText(BODY_ROOT).toString()).toBe('hello');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.attribution?.userId).toBe('bob');
  });

  test('line-join via deleted newline attributes the merged line to the deleter, not either original author', () => {
    const ydoc = newDoc();
    const row1 = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).insert(0, 'top\n'), USER('alice'), '2026-01-01T00:00:00.000Z');
    const row2 = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).insert(4, 'bottom'), USER('bob'), '2026-01-01T00:01:00.000Z');
    // Carol deletes the '\n' at index 3, joining "top" and "bottom" into a single live line "topbottom".
    const row3 = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).delete(3, 1), USER('carol'), '2026-01-01T00:05:00.000Z');

    const { lines } = computeBlame(ydoc, buildRangeIndex([row1, row2, row3]));

    expect(ydoc.getText(BODY_ROOT).toString()).toBe('topbottom');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.attribution?.userId).toBe('carol');
  });

  test('undo (an ordinary delete performed by the undoer) attributes the affected line to the undoer, not the original author', () => {
    const ydoc = newDoc();
    const row1 = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).insert(0, 'alice wrote this'), USER('alice'), '2026-01-01T00:00:00.000Z');

    // Bob undoes Alice's insertion from his own session. `Y.UndoManager` undoing an insert produces, at
    // the byte level, an ordinary delete over the same range — `doc_updates` records whichever connection
    // (Bob's) performed it, exactly like any other delete, so this is what a real Ctrl+Z looks like on the
    // wire; the module under test never needs to know "undo" happened as a distinct concept.
    const row2 = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).delete(0, 'alice wrote this'.length), USER('bob'), '2026-01-01T00:10:00.000Z');

    const { lines } = computeBlame(ydoc, buildRangeIndex([row1, row2]));

    expect(ydoc.getText(BODY_ROOT).toString()).toBe('');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.attribution?.userId).toBe('bob');
  });

  test('restore: re-inserted historical content is attributed to the restorer, never the original author', () => {
    const ydoc = newDoc();
    const row1 = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).insert(0, 'v1 content'), USER('alice'), '2026-01-01T00:00:00.000Z');
    const row2 = recordRow(
      ydoc,
      () => {
        ydoc.getText(BODY_ROOT).delete(0, ydoc.getText(BODY_ROOT).length);
        ydoc.getText(BODY_ROOT).insert(0, 'v2 content');
      },
      USER('bob'),
      '2026-01-01T00:01:00.000Z',
    );
    // Carol restores v1: a server-side transaction re-inserting v1's content as fresh structs (WO-157 —
    // never a raw UPDATE of working_state, always a fresh attributed transaction).
    const row3 = recordRow(
      ydoc,
      () => {
        ydoc.getText(BODY_ROOT).delete(0, ydoc.getText(BODY_ROOT).length);
        ydoc.getText(BODY_ROOT).insert(0, 'v1 content');
      },
      USER('carol'),
      '2026-01-01T00:10:00.000Z',
    );

    const { lines } = computeBlame(ydoc, buildRangeIndex([row1, row2, row3]));

    expect(ydoc.getText(BODY_ROOT).toString()).toBe('v1 content');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.attribution?.userId).toBe('carol');
  });

  test('a system:engine transaction on behalf of a user is attributed with actorKind "system" and onBehalfOf', () => {
    const ydoc = newDoc();
    const row = recordRow(ydoc, () => ydoc.getText(BODY_ROOT).insert(0, 'engine-written content'), SYSTEM_ON_BEHALF_OF('dana'), '2026-01-01T00:00:00.000Z');

    const { lines } = computeBlame(ydoc, buildRangeIndex([row]));

    expect(lines[0]!.attribution).toEqual({ actorKind: 'system', userId: null, onBehalfOf: 'dana', agentId: null, receivedAt: '2026-01-01T00:00:00.000Z' });
  });

  test('an agent-accept transaction is attributed with actorKind "agent", agentId, and the accepting user\'s onBehalfOf', () => {
    const ydoc = newDoc();
    const row = recordRow(
      ydoc,
      () => ydoc.getText(BODY_ROOT).insert(0, 'agent-proposed content'),
      AGENT_ON_BEHALF_OF('agent:deepseek', 'erin'),
      '2026-01-01T00:00:00.000Z',
    );

    const { lines } = computeBlame(ydoc, buildRangeIndex([row]));

    expect(lines[0]!.attribution).toEqual({ actorKind: 'agent', userId: null, onBehalfOf: 'erin', agentId: 'agent:deepseek', receivedAt: '2026-01-01T00:00:00.000Z' });
  });

  test('per-field frontmatter blame: last writer wins per key', () => {
    const ydoc = newDoc();
    const row1 = recordRow(ydoc, () => ydoc.getMap(FRONTMATTER_ROOT).set('title', 'Draft title'), USER('alice'), '2026-01-01T00:00:00.000Z');
    const row2 = recordRow(ydoc, () => ydoc.getMap(FRONTMATTER_ROOT).set('tags', ['a', 'b']), USER('bob'), '2026-01-01T00:01:00.000Z');
    const row3 = recordRow(ydoc, () => ydoc.getMap(FRONTMATTER_ROOT).set('title', 'Final title'), USER('carol'), '2026-01-01T00:02:00.000Z');

    const { fields } = computeBlame(ydoc, buildRangeIndex([row1, row2, row3]));

    expect(fields.title!.attribution?.userId).toBe('carol');
    expect(fields.tags!.attribution?.userId).toBe('bob');
  });

  test('an empty document has a single line with no attribution when there is no update history', () => {
    const ydoc = newDoc();
    const { lines, fields } = computeBlame(ydoc, buildRangeIndex([]));
    expect(lines).toEqual([{ line: 0, attribution: null }]);
    expect(fields).toEqual({});
  });

  test('two concurrent clients merged via applyUpdate resolve blame through the index, not Yjs client ids directly', () => {
    const server = newDoc();
    const clientA = newDoc();
    Y.applyUpdate(clientA, Y.encodeStateAsUpdate(server));
    const clientB = newDoc();
    Y.applyUpdate(clientB, Y.encodeStateAsUpdate(server));

    const updateA = (() => {
      const before = Y.encodeStateVector(clientA);
      clientA.getText(BODY_ROOT).insert(0, 'from A\n');
      return Y.encodeStateAsUpdate(clientA, before);
    })();
    const updateB = (() => {
      const before = Y.encodeStateVector(clientB);
      clientB.getText(BODY_ROOT).insert(0, 'from B\n');
      return Y.encodeStateAsUpdate(clientB, before);
    })();

    const rowA: RangeIndexRow = { ...decodeUpdateRanges(updateA), ...USER('alice'), receivedAt: '2026-01-01T00:00:00.000Z' };
    const rowB: RangeIndexRow = { ...decodeUpdateRanges(updateB), ...USER('bob'), receivedAt: '2026-01-01T00:01:00.000Z' };

    Y.applyUpdate(server, updateA);
    Y.applyUpdate(server, updateB);

    const { lines } = computeBlame(server, buildRangeIndex([rowA, rowB]));
    const mergedLines = server.getText(BODY_ROOT).toString().split('\n');

    // Yjs resolves the concurrent-insert-at-index-0 conflict by client id order, so which author ends up
    // first is not asserted here — what matters is every live line traces back to one of the two real
    // authors (never `undefined`/a third identity), and the content lines match what each author wrote.
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.attribution && ['alice', 'bob'].includes(l.attribution.userId ?? ''))).toBe(true);
    expect(mergedLines[0]).toBe(lines[0]!.attribution?.userId === 'alice' ? 'from A' : 'from B');
    expect(mergedLines[1]).toBe(lines[1]!.attribution?.userId === 'alice' ? 'from A' : 'from B');
  });
});
