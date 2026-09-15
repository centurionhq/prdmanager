/**
 * Pure decode of a Yjs update's `(client, clock, len)` struct and delete-set ranges (SDD-008
 * §"Autoría por línea no falsificable"). No I/O, no Hocuspocus — used by `packages/server`'s `onChange`
 * hook (WO-149, to persist what an update touched before broadcasting it) and by its `beforeSync`
 * anti-spoofing check (WO-150, to compare an incoming update's ranges against the server's own state
 * vector) alike, so the two can never decode the same bytes differently.
 *
 * `Y.parseUpdateMeta` gives, per client id present in the update, the first (`from`) and one-past-the-
 * last (`to`) clock the update contains — exactly a `[from, to)` struct range. `Y.decodeUpdate`'s
 * `DeleteSet.clients` gives the deleted `(clock, len)` items per client directly.
 */
import * as Y from 'yjs';

export interface StructRange {
  client: number;
  /** Inclusive start clock. */
  from: number;
  /** Exclusive end clock. */
  to: number;
}

export interface DeleteRange {
  client: number;
  clock: number;
  len: number;
}

export interface DecodedUpdateRanges {
  structRanges: StructRange[];
  deleteRanges: DeleteRange[];
}

export function decodeUpdateRanges(update: Uint8Array): DecodedUpdateRanges {
  const { from, to } = Y.parseUpdateMeta(update);
  const structRanges: StructRange[] = [];
  to.forEach((toClock, client) => {
    structRanges.push({ client, from: from.get(client) ?? 0, to: toClock });
  });

  const { ds } = Y.decodeUpdate(update);
  const deleteRanges: DeleteRange[] = [];
  ds.clients.forEach((items, client) => {
    for (const item of items) deleteRanges.push({ client, clock: item.clock, len: item.len });
  });

  return { structRanges, deleteRanges };
}
