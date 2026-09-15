/**
 * Pure per-line and per-field blame computation (SDD-008 §"Autoría por línea no falsificable"). No I/O,
 * no Hocuspocus, no database — given a `Y.Doc` and a {@link RangeIndex} built from `doc_updates` rows
 * (see {@link buildRangeIndex}), this walks the live `Y.Text('body')` item chain and the `Y.Map('fm')`
 * entries and attributes each line/field to whoever most recently touched it.
 *
 * Server transactions (`system:engine`, `agent:*` on behalf of a user, a version restore) get a *fresh*
 * Yjs client id every time (WO-150's design note in `packages/server/src/collab/doc-update-writer.ts`),
 * so blame is resolved purely from each `doc_updates` row's own `actor_kind`/`user_id`/`on_behalf_of`/
 * `agent_id` columns — never from a `doc_client_bindings` lookup by client id, which would be wrong for
 * exactly those rows (a fresh client id every time means no single binding to look up). This is why
 * {@link buildRangeIndex} takes rows shaped like `doc_updates` directly, not client-id bindings.
 *
 * Algorithm (per SDD-008: "Por línea devuelve el actor y la fecha de la modificación más reciente según
 * received_at (inserción en la línea, o borrado que la afectó, incluida la unión de dos líneas al borrar
 * un salto)"):
 * - Walk `Y.Text`'s internal item chain (`_start`/`.right`, both declared public fields of `AbstractType`
 *   in yjs 13.6.32's own `.d.ts` — no unsafe cast needed) in list order, tracking `currentLine`, the
 *   0-indexed live line the walk is currently positioned in.
 * - A **live** (non-deleted) item's text is split on `\n`: each resulting part attributes `currentLine`
 *   to this item's insert attribution (looked up by the item's own `(client, clock)`, since inserted
 *   text and its author never change once written), and each `\n` boundary advances `currentLine` — this
 *   is what makes an item spanning a pasted multi-line block attribute every line it touches.
 * - A **deleted** (tombstoned) item — kept because the doc is opened with `gc: false` — never advances
 *   `currentLine` (its content, if it had a `\n`, never became visible), but its delete attribution (who
 *   performed the delete, looked up by the deleted item's own `(client, clock)` — the delete set always
 *   references the *original* item's id, never the deleter's) competes for `currentLine`. This is exactly
 *   what makes deleting a `\n` that joined two once-separate lines attribute the resulting single live
 *   line to the deleter: the join means one fewer `currentLine` advance happened than there would have
 *   been, so both formerly-separate lines' content collapses onto the same `currentLine` bucket, and the
 *   delete's timestamp can outrank the surviving text's own insert timestamp there.
 * - Per-field frontmatter blame is simpler: `Y.Map`'s own `_map` (also a public `AbstractType` field)
 *   holds the *current* item for each live key directly — no chain walk needed, just an insert lookup by
 *   that item's `(client, clock)`.
 *
 * Undo is not special-cased: `Y.UndoManager` undoing an insert is, at the byte level, an ordinary delete
 * by whoever triggered it; undoing a delete (redo) is an ordinary fresh insert by whoever triggered it.
 * Both flow through the exact same insert/delete attribution rules above, and `doc_updates` durably
 * records the *acting* connection's identity for either — the caller never needs to distinguish "the user
 * pressed Ctrl+Z" from "the user typed new text" here, and neither does this module. Likewise version
 * restore (WO-157) is just a server transaction with a fresh client id, attributed via `on_behalf_of` to
 * the restoring user.
 */
import * as Y from 'yjs';
import { BODY_ROOT, FRONTMATTER_ROOT } from './schema.js';
import type { DeleteRange, StructRange } from './update-ranges.js';

export type BlameActorKind = 'user' | 'agent' | 'system';

/** Raw attribution as read straight off a `doc_updates` row — display formatting (e.g. SDD-008's
 * "Agente (aceptado por Ana)" phrasing) is a UI concern (WO-161), not this module's. */
export interface BlameAttribution {
  actorKind: BlameActorKind;
  userId: string | null;
  onBehalfOf: string | null;
  agentId: string | null;
  /** ISO 8601 — always a string so callers never need to worry about `Date` object identity/serialization
   * across a network boundary (this is what an API response and a unit test both compare directly). */
  receivedAt: string;
}

export interface LineBlame {
  /** 0-indexed, matching `body.split('\n')`. */
  line: number;
  /** `null` only when no `doc_updates` row ever accounts for this line — e.g. a document with a working
   * copy but no recorded update history yet (should not happen once a document has ever been edited
   * through Hocuspocus, but a caller must handle it rather than crash). */
  attribution: BlameAttribution | null;
}

export interface FieldBlame {
  key: string;
  attribution: BlameAttribution | null;
}

export interface BlameResult {
  lines: LineBlame[];
  fields: Record<string, FieldBlame>;
}

/** One `doc_updates` row's worth of range/attribution data — the shape {@link buildRangeIndex} consumes.
 * Deliberately structural (not imported from `@prdm/db`'s schema types) so this package stays isomorphic
 * and has no dependency on the server's database layer. */
export interface RangeIndexRow {
  structRanges: readonly StructRange[];
  deleteRanges: readonly DeleteRange[];
  actorKind: BlameActorKind;
  userId: string | null;
  onBehalfOf: string | null;
  agentId: string | null;
  /** Accepts either so a caller can pass a `doc_updates.received_at` `Date` straight from the database or
   * an already-serialized ISO string in a test fixture. */
  receivedAt: Date | string;
}

/** `(client, clock-range) → {actor, receivedAt}`, built once from a document's full `doc_updates` history
 * (SDD-008 §"Autoría por línea no falsificable") and queried once per item while walking the `Y.Doc`. */
export interface RangeIndex {
  /** Attribution for the insertion of the struct at `(client, clock)` — `undefined` if no `doc_updates`
   * row's struct ranges cover it (a gap in recorded history). */
  lookupInsert(client: number, clock: number): BlameAttribution | undefined;
  /** Attribution for whoever deleted the struct originally identified by `(client, clock)` — `undefined`
   * if it was never recorded as deleted (e.g. still-live content, or missing history). */
  lookupDelete(client: number, clock: number): BlameAttribution | undefined;
}

interface Interval {
  from: number;
  to: number;
  attribution: BlameAttribution;
}

function toIsoString(receivedAt: Date | string): string {
  return typeof receivedAt === 'string' ? receivedAt : receivedAt.toISOString();
}

function pushInterval(byClient: Map<number, Interval[]>, client: number, from: number, to: number, attribution: BlameAttribution): void {
  const intervals = byClient.get(client) ?? [];
  intervals.push({ from, to, attribution });
  byClient.set(client, intervals);
}

function findInterval(byClient: Map<number, Interval[]>, client: number, clock: number): BlameAttribution | undefined {
  const intervals = byClient.get(client);
  if (!intervals) return undefined;
  // Overlapping intervals for the same client are not expected (a clock is only ever recorded once), but
  // if history is ever replayed twice, the most-recently-received row wins rather than the first found.
  let best: Interval | undefined;
  for (const interval of intervals) {
    if (clock < interval.from || clock >= interval.to) continue;
    if (!best || interval.attribution.receivedAt > best.attribution.receivedAt) best = interval;
  }
  return best?.attribution;
}

/** Builds a {@link RangeIndex} from a document's `doc_updates` rows. Rows may be passed in any order —
 * attribution is resolved purely by which interval a clock falls into, never by row order. */
export function buildRangeIndex(rows: readonly RangeIndexRow[]): RangeIndex {
  const insertsByClient = new Map<number, Interval[]>();
  const deletesByClient = new Map<number, Interval[]>();

  for (const row of rows) {
    const attribution: BlameAttribution = {
      actorKind: row.actorKind,
      userId: row.userId,
      onBehalfOf: row.onBehalfOf,
      agentId: row.agentId,
      receivedAt: toIsoString(row.receivedAt),
    };
    for (const range of row.structRanges) pushInterval(insertsByClient, range.client, range.from, range.to, attribution);
    for (const range of row.deleteRanges) pushInterval(deletesByClient, range.client, range.clock, range.clock + range.len, attribution);
  }

  return {
    lookupInsert: (client, clock) => findInterval(insertsByClient, client, clock),
    lookupDelete: (client, clock) => findInterval(deletesByClient, client, clock),
  };
}

function isMoreRecent(candidate: string, current: string | undefined): boolean {
  return current === undefined || candidate > current;
}

/** Walks `body`'s live text (line blame) and `fm`'s live keys (field blame) and attributes each to the
 * most recent `doc_updates`-recorded touch, per `index`. See this module's top-of-file doc comment for the
 * full algorithm. */
export function computeBlame(ydoc: Y.Doc, index: RangeIndex): BlameResult {
  const body = ydoc.getText(BODY_ROOT);
  const liveText = body.toString();
  const lineCount = liveText.length === 0 ? 1 : liveText.split('\n').length;

  // Two tiers per line, so that an item whose *trailing* part is empty (it ends exactly on a `\n`, e.g.
  // "from B\n") never outranks the item that actually supplies the next line's real characters just
  // because it happened to be recorded more recently: a "strong" touch is real live content (a non-empty
  // part) or any delete (a delete always genuinely affects the line, per SDD-008); a "weak" touch is an
  // empty part contributed only because it's the boundary edge of a multi-line item, and only wins a line
  // when nothing strong ever touches it (e.g. an intentionally blank line). Ties within a tier still go to
  // the most recent `receivedAt`.
  const strongByLine: (BlameAttribution | undefined)[] = new Array(lineCount).fill(undefined);
  const weakByLine: (BlameAttribution | undefined)[] = new Array(lineCount).fill(undefined);

  function attributeLine(byLine: (BlameAttribution | undefined)[], lineIndex: number, attribution: BlameAttribution | undefined): void {
    if (!attribution || lineIndex < 0 || lineIndex >= lineCount) return;
    if (isMoreRecent(attribution.receivedAt, byLine[lineIndex]?.receivedAt)) {
      byLine[lineIndex] = attribution;
    }
  }

  let currentLine = 0;
  let item: Y.Item | null = body._start;
  while (item) {
    if (!(item.content instanceof Y.ContentString)) {
      item = item.right;
      continue;
    }

    if (item.deleted) {
      // The delete set always references the *original* item's (client, clock) — never the deleter's —
      // so this is an insert-shaped id looked up in the delete index, not the insert index.
      attributeLine(strongByLine, currentLine, index.lookupDelete(item.id.client, item.id.clock));
      item = item.right;
      continue;
    }

    const attribution = index.lookupInsert(item.id.client, item.id.clock);
    const parts = item.content.str.split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      const isEmptyBoundaryPart = (parts[i]?.length ?? 0) === 0 && parts.length > 1;
      attributeLine(isEmptyBoundaryPart ? weakByLine : strongByLine, currentLine, attribution);
      if (i < parts.length - 1) currentLine += 1;
    }
    item = item.right;
  }

  const lines: LineBlame[] = strongByLine.map((attribution, line) => ({ line, attribution: attribution ?? weakByLine[line] ?? null }));

  const fm = ydoc.getMap(FRONTMATTER_ROOT);
  const fields: Record<string, FieldBlame> = {};
  fm.forEach((_value, key) => {
    const item = fm._map.get(key);
    const attribution = item ? index.lookupInsert(item.id.client, item.id.clock) : undefined;
    fields[key] = { key, attribution: attribution ?? null };
  });

  return { lines, fields };
}
