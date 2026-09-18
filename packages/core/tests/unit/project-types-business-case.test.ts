import { describe, expect, test } from 'vitest';
import { DEFAULT_FOLDERS } from '../../src/project/types.js';

/** PRD-011 §4.1/SDD-022 (WO-434): FolderMap is Record<DocKind, string>, so the compiler already enforces
 * that every kind has an entry -- this just pins the actual value. */
describe('DEFAULT_FOLDERS.BC (WO-434)', () => {
  test('BC documents live under docs/business-case', () => {
    expect(DEFAULT_FOLDERS.BC).toBe('docs/business-case');
  });
});
