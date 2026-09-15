/**
 * The collaborative document's `Y.Doc` shape (SDD-008 §"Representación del documento"): exactly two
 * roots, `Y.Map('fm')` (editable frontmatter — last-write-wins per key, primitive values or string
 * arrays only) and `Y.Text('body')` (the Markdown body, edited without any rich-text transformation).
 * Any other root, or a nested Yjs type / non-primitive value written into `fm`, is invalid and must be
 * rejected before it is ever accepted into the shared document (used later by the anti-abuse WO and by
 * the frontmatter form in the editor UI batch).
 *
 * Deliberately isomorphic (no Node-only APIs): this module is imported by both `packages/server`
 * (Hocuspocus persistence/hooks) and, in a later batch, `packages/app` (the CodeMirror editor and its
 * frontmatter form).
 */
import * as Y from 'yjs';

/** The only two valid roots of a collaborative document's `Y.Doc` (SDD-008). */
export const FRONTMATTER_ROOT = 'fm';
export const BODY_ROOT = 'body';

const VALID_ROOTS: ReadonlySet<string> = new Set([FRONTMATTER_ROOT, BODY_ROOT]);

/** Thrown by {@link assertValidRoot} — never a boolean return, so a caller can't accidentally ignore a
 * rejected value. */
export class InvalidDocumentRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocumentRootError';
  }
}

/** Primitive values `fm` may hold for a single key (SDD-008: "valores primitivos o arrays de strings"). */
export type FrontmatterPrimitive = string | number | boolean;
export type FrontmatterValue = FrontmatterPrimitive | string[];

function isFrontmatterValue(value: unknown): value is FrontmatterValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every((item) => typeof item === 'string');
  return false;
}

function isNestedYjsType(value: unknown): boolean {
  return value instanceof Y.AbstractType;
}

/**
 * Rejects any root other than `fm`/`body` (SDD-008: "Solo esas dos raíces son válidas; cualquier otra
 * raíz o tipo anidado en un update se rechaza") and, for `fm`, any nested Yjs type or value that isn't a
 * primitive or a string array. `body` has no per-key value to validate (it's a `Y.Text`), so `key`/
 * `value` are only inspected when `root === FRONTMATTER_ROOT`.
 */
export function assertValidRoot(root: string, key: string, value: unknown): void {
  if (!VALID_ROOTS.has(root)) {
    throw new InvalidDocumentRootError(`"${root}" is not a valid document root (only "${FRONTMATTER_ROOT}" and "${BODY_ROOT}" are allowed)`);
  }
  if (root !== FRONTMATTER_ROOT) return;
  if (isNestedYjsType(value)) {
    throw new InvalidDocumentRootError(`frontmatter field "${key}" must not be a nested Yjs type`);
  }
  if (!isFrontmatterValue(value)) {
    throw new InvalidDocumentRootError(`frontmatter field "${key}" must be a string, number, boolean, or an array of strings`);
  }
}

/**
 * Builds a fresh collaborative document with both roots already materialized and `gc: false` (SDD-008:
 * disabling garbage collection is required so deleted structs stay addressable for blame/undo). Callers
 * that need to hydrate it from persisted state should apply the update with `Y.applyUpdate` right after.
 */
export function createDocumentYDoc(): Y.Doc {
  const ydoc = new Y.Doc({ gc: false });
  ydoc.getMap(FRONTMATTER_ROOT);
  ydoc.getText(BODY_ROOT);
  return ydoc;
}
