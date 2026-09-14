import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import { decodeUpdateRanges } from '../../src/update-ranges.js';

describe('decodeUpdateRanges', () => {
  test('decodes a single insert from one client as one struct range with no deletes', () => {
    const doc = new Y.Doc({ gc: false });
    let update: Uint8Array | undefined;
    doc.on('update', (u: Uint8Array) => {
      update = u;
    });
    doc.getText('body').insert(0, 'hello');

    const { structRanges, deleteRanges } = decodeUpdateRanges(update!);
    expect(structRanges).toEqual([{ client: doc.clientID, from: 0, to: 5 }]);
    expect(deleteRanges).toEqual([]);
  });

  test('decodes a delete as a delete range on the deleting update, referencing the deleted clock', () => {
    const doc = new Y.Doc({ gc: false });
    doc.getText('body').insert(0, 'hello');

    let deleteUpdate: Uint8Array | undefined;
    doc.on('update', (u: Uint8Array) => {
      deleteUpdate = u;
    });
    doc.getText('body').delete(0, 5);

    const { deleteRanges } = decodeUpdateRanges(deleteUpdate!);
    expect(deleteRanges).toEqual([{ client: doc.clientID, clock: 0, len: 5 }]);
  });

  test('merges multiple synchronous inserts from the same transaction into one contiguous range', () => {
    const doc = new Y.Doc({ gc: false });
    let update: Uint8Array | undefined;
    doc.on('update', (u: Uint8Array) => {
      update = u;
    });
    doc.transact(() => {
      const text = doc.getText('body');
      text.insert(0, 'a');
      text.insert(1, 'b');
      text.insert(2, 'c');
    });

    const { structRanges } = decodeUpdateRanges(update!);
    expect(structRanges).toEqual([{ client: doc.clientID, from: 0, to: 3 }]);
  });

  test('decodes struct ranges for two different clients merged into one update', () => {
    const a = new Y.Doc({ gc: false });
    const b = new Y.Doc({ gc: false });
    a.getText('body').insert(0, 'from a');
    b.getText('body').insert(0, 'from b');

    const merged = Y.mergeUpdates([Y.encodeStateAsUpdate(a), Y.encodeStateAsUpdate(b)]);
    const { structRanges } = decodeUpdateRanges(merged);
    const clients = structRanges.map((r) => r.client).sort();
    expect(clients).toEqual([a.clientID, b.clientID].sort());
  });
});
