/**
 * Comment anchors as `Y.RelativePosition`s (SDD-008 §"Comentarios": "hilos anclados con Y.RelativePosition
 * ... sobre el cuerpo; el texto citado lo calcula el servidor desde las anclas"). Isomorphic and pure — no
 * database, no HTTP — so both `packages/server` (the comments routes, WO-158) and, in a later batch,
 * `packages/app` (WO-162's in-editor highlight) resolve an anchor identically.
 *
 * A `Y.RelativePosition` survives concurrent edits elsewhere in the document (SDD-008's own explicit test
 * case) because it's expressed relative to a specific struct id, not a plain character offset — exactly
 * what makes it the right anchor type here instead of `{start: number, end: number}`.
 */
import * as Y from 'yjs';
import { BODY_ROOT } from './schema.js';

export interface EncodedCommentAnchor {
  start: Uint8Array;
  end: Uint8Array;
}

export interface ResolvedCommentAnchor {
  /** `null` when the anchored text no longer exists — either endpoint's relative position no longer
   * resolves at all, or it resolves to a collapsed (zero-length) range because everything between them
   * was deleted (SDD-008: "Si el texto anclado desaparece, el hilo queda 'sin ancla' pero visible" —
   * callers show this as "texto eliminado", never a crash). */
  quotedText: string | null;
  /** The current absolute `[from, to)` character range the anchor resolves to — `null` under the exact
   * same conditions as `quotedText`. `packages/app`'s WO-162 in-editor highlight/jump-to-anchor is the
   * only consumer that needs this; the server (WO-158) only ever reads `quotedText`. */
  range: { from: number; to: number } | null;
}

/** Builds an anchor from a live `[startIndex, endIndex)` character range in `ydoc`'s `body` — the offsets
 * a client's current text selection maps to at the moment a thread is created. */
export function createCommentAnchor(ydoc: Y.Doc, startIndex: number, endIndex: number): EncodedCommentAnchor {
  const body = ydoc.getText(BODY_ROOT);
  const relStart = Y.createRelativePositionFromTypeIndex(body, startIndex);
  const relEnd = Y.createRelativePositionFromTypeIndex(body, endIndex);
  return { start: Y.encodeRelativePosition(relStart), end: Y.encodeRelativePosition(relEnd) };
}

/** Resolves `anchor` against `ydoc`'s *current* state — the quoted text this returns always reflects
 * whatever the document looks like right now, never a stale copy taken at creation time. */
export function resolveCommentAnchor(ydoc: Y.Doc, anchor: EncodedCommentAnchor): ResolvedCommentAnchor {
  const body = ydoc.getText(BODY_ROOT);
  const relStart = Y.decodeRelativePosition(anchor.start);
  const relEnd = Y.decodeRelativePosition(anchor.end);
  const absStart = Y.createAbsolutePositionFromRelativePosition(relStart, ydoc);
  const absEnd = Y.createAbsolutePositionFromRelativePosition(relEnd, ydoc);
  if (!absStart || !absEnd || absEnd.index <= absStart.index) return { quotedText: null, range: null };
  return { quotedText: body.toString().slice(absStart.index, absEnd.index), range: { from: absStart.index, to: absEnd.index } };
}
