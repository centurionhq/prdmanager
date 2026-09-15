import { describe, expect, test } from 'vitest';
import { assertSafeImportSourcePath, DEFAULT_FOLDERS, UnsafeImportSourcePathError } from '@prdm/core';

describe('assertSafeImportSourcePath (SDD-010, WO-192)', () => {
  test('accepts a path that fits <kind folder>/<ID>*.md', () => {
    expect(() => assertSafeImportSourcePath('PRD', 'PRD-001', DEFAULT_FOLDERS, 'docs/prd/PRD-001-my-title.md')).not.toThrow();
  });

  test.each([
    ['NUL byte', 'docs/prd/PRD-001\0.md'],
    ['backslash', 'docs\\prd\\PRD-001.md'],
    ['absolute path', '/etc/passwd'],
    ['parent traversal', '../evil/PRD-001.md'],
    ['dot segment', 'docs/./prd/PRD-001.md'],
    ['wrong kind folder', 'docs/sdd/PRD-001.md'],
    ['subdirectory under the kind folder', 'docs/prd/nested/PRD-001.md'],
    ['basename does not start with the id', 'docs/prd/OTHER-001.md'],
    ['missing .md extension', 'docs/prd/PRD-001.txt'],
  ])('rejects: %s', (_label, path) => {
    expect(() => assertSafeImportSourcePath('PRD', 'PRD-001', DEFAULT_FOLDERS, path)).toThrow(UnsafeImportSourcePathError);
  });
});
