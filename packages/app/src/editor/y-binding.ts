/**
 * Bridges `edit-ops.ts`'s pure {@link Splice} results onto a real `Y.Text` (SDD-014 §"Editor de vista
 * previa"). `PREVIEW_ORIGIN` must never be reused as (or equal to) any `HocuspocusProvider` instance:
 * `@hocuspocus/provider`'s own `documentUpdateHandler` drops a local update outright when its transaction
 * origin `=== this` (the provider itself), which is how it avoids re-sending updates it just received from
 * the server — a preview edit transacted under that same origin would silently never leave the browser.
 * A module-level `Symbol` can't equal any object, so this is safe by construction, not merely by convention.
 */
import * as Y from 'yjs';
import type { Splice } from './edit-ops.js';
import { recordEdit } from './parse-cache.js';

export const PREVIEW_ORIGIN = Symbol('preview-editor');

/**
 * Applies `splice` to `ytext` in one transaction. The delete runs before the insert, and both use
 * `splice`'s own offsets as given (absolute positions in `ytext` *before* this transaction) — recomputing
 * an offset between the two calls would double-count the just-deleted range.
 *
 * Primes `parse-cache.ts` with the resulting source right after (WO-384): this is the one point every
 * local edit passes through with its exact `{ from, oldEnd, newEnd }` range already known, so it's the
 * cheapest place to do the (incremental) re-parse the edit needs, once, instead of leaving every caller of
 * `classifyCached` to re-parse the whole document independently.
 */
export function applySplice(ytext: Y.Text, splice: Splice): void {
  const doc = ytext.doc;
  if (!doc) throw new Error('applySplice requires a Y.Text already attached to a Y.Doc');

  doc.transact(() => {
    if (splice.to > splice.from) ytext.delete(splice.from, splice.to - splice.from);
    if (splice.insert.length > 0) ytext.insert(splice.from, splice.insert);
  }, PREVIEW_ORIGIN);

  recordEdit(ytext, ytext.toString(), { from: splice.from, oldEnd: splice.to, newEnd: splice.from + splice.insert.length });
}

/**
 * Minimal integration point for the shared `Y.UndoManager` (today constructed per-mount inside
 * `packages/app/src/collab/editor-extensions.ts`, only while the Markdown CodeMirror tab is on screen —
 * lifting it into `CollabDocumentProvider` so it outlives either tab is `packages/app/src/collab/`'s call,
 * out of this WO's `packages/app/src/editor/`/`packages/collab/` scope, and left for the WO that wires the
 * Preview tab into that context). Whoever owns that `UndoManager` instance calls this once so preview edits
 * become undoable alongside Markdown-tab edits instead of silently falling outside `trackedOrigins`
 * (`Y.UndoManager` only tracks `null`-origin transactions by default).
 */
export function attachPreviewOriginToUndoManager(undoManager: Y.UndoManager): void {
  undoManager.addTrackedOrigin(PREVIEW_ORIGIN);
}
