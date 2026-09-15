import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import { assertValidRoot, BODY_ROOT, createDocumentYDoc, FRONTMATTER_ROOT, InvalidDocumentRootError } from '../../src/schema.js';

describe('createDocumentYDoc', () => {
  test('creates a Y.Doc with gc disabled', () => {
    const ydoc = createDocumentYDoc();
    expect(ydoc.gc).toBe(false);
  });

  test('materializes exactly the fm map and body text roots', () => {
    const ydoc = createDocumentYDoc();
    expect(ydoc.share.has(FRONTMATTER_ROOT)).toBe(true);
    expect(ydoc.share.has(BODY_ROOT)).toBe(true);
    expect(ydoc.share.size).toBe(2);
  });
});

describe('assertValidRoot', () => {
  test('accepts primitive values under fm', () => {
    expect(() => assertValidRoot(FRONTMATTER_ROOT, 'title', 'hello')).not.toThrow();
    expect(() => assertValidRoot(FRONTMATTER_ROOT, 'priority', 3)).not.toThrow();
    expect(() => assertValidRoot(FRONTMATTER_ROOT, 'archived', false)).not.toThrow();
  });

  test('accepts string arrays under fm', () => {
    expect(() => assertValidRoot(FRONTMATTER_ROOT, 'tags', ['a', 'b'])).not.toThrow();
  });

  test('rejects non-string array entries under fm', () => {
    expect(() => assertValidRoot(FRONTMATTER_ROOT, 'tags', ['a', 1 as unknown as string])).toThrow(InvalidDocumentRootError);
  });

  test('rejects a plain object under fm', () => {
    expect(() => assertValidRoot(FRONTMATTER_ROOT, 'weird', { nested: true })).toThrow(InvalidDocumentRootError);
  });

  test('rejects null/undefined under fm', () => {
    expect(() => assertValidRoot(FRONTMATTER_ROOT, 'weird', null)).toThrow(InvalidDocumentRootError);
    expect(() => assertValidRoot(FRONTMATTER_ROOT, 'weird', undefined)).toThrow(InvalidDocumentRootError);
  });

  test('rejects a nested Yjs type under fm', () => {
    const nested = new Y.Map();
    expect(() => assertValidRoot(FRONTMATTER_ROOT, 'nested', nested)).toThrow(InvalidDocumentRootError);
  });

  test('rejects any root other than fm/body', () => {
    expect(() => assertValidRoot('evil', 'k', 'v')).toThrow(InvalidDocumentRootError);
    expect(() => assertValidRoot('', 'k', 'v')).toThrow(InvalidDocumentRootError);
  });

  test('does not validate values for the body root (no per-key value there)', () => {
    expect(() => assertValidRoot(BODY_ROOT, 'irrelevant', { anything: true })).not.toThrow();
  });
});
