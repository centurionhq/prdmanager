/**
 * Pure projection between a collaborative `Y.Doc` and a plain `{title, fields, body}` shape (SDD-008
 * §"Representación del documento": "Proyección pura projectDoc(ydoc) → {title, fields, body} usada por
 * validación, versiones, publicación, agente e importador"). No I/O, no Hocuspocus, no database —
 * everything here is synchronous and deterministic given a `Y.Doc`.
 */
import * as Y from 'yjs';
import { assertValidRoot, BODY_ROOT, FRONTMATTER_ROOT, type FrontmatterValue } from './schema.js';

export interface DocProjection {
  /** Convenience copy of `fields.title` (empty string when unset/not a string) — every document has a
   * title field, so callers that only need it don't have to narrow `fields.title` themselves. */
  title: string;
  fields: Record<string, FrontmatterValue>;
  body: string;
}

/** Reads the current `fm`/`body` roots into a plain, serializable projection. */
export function projectDoc(ydoc: Y.Doc): DocProjection {
  const fm = ydoc.getMap<FrontmatterValue>(FRONTMATTER_ROOT);
  const fields: Record<string, FrontmatterValue> = {};
  fm.forEach((value, key) => {
    fields[key] = value;
  });
  const title = typeof fields.title === 'string' ? fields.title : '';
  const body = ydoc.getText(BODY_ROOT).toString();
  return { title, fields, body };
}

/**
 * The reverse of {@link projectDoc}: replaces the current `fm`/`body` contents with `projection`'s,
 * inside a single transaction tagged with `origin` (so `beforeSync`/`onChange` hooks and observers can
 * tell a hydration/import apart from a live edit). Used for initial hydration (importing a document with
 * no working copy yet) and for restoring a projection built elsewhere (e.g. version restore) — never for
 * incremental edits, which mutate the `Y.Doc` directly.
 */
export function applyProjection(ydoc: Y.Doc, projection: DocProjection, origin?: unknown): void {
  ydoc.transact(() => {
    const fm = ydoc.getMap<FrontmatterValue>(FRONTMATTER_ROOT);
    for (const key of Array.from(fm.keys())) fm.delete(key);

    const fields: Record<string, FrontmatterValue> = { ...projection.fields, title: projection.title };
    for (const [key, value] of Object.entries(fields)) {
      assertValidRoot(FRONTMATTER_ROOT, key, value);
      fm.set(key, value);
    }

    const body = ydoc.getText(BODY_ROOT);
    body.delete(0, body.length);
    body.insert(0, projection.body);
  }, origin);
}
