/**
 * Commit DTO validation (SDD-012, WO-326): mirrors `@prdm/db`'s `commits` table
 * (`packages/db/src/schema/documents.ts`) fields a client actually needs to display.
 */
import { describe, expect, test } from 'vitest';
import { commitDtoSchema } from '../../src/commits.js';

describe('commitDtoSchema', () => {
  const valid = {
    sha: 'a'.repeat(40),
    subject: 'fix: correct drift detection',
    author: 'Ada Lovelace',
    date: '2026-09-01T00:00:00.000Z',
    refs: ['WO-334'],
    files: ['packages/server/src/engine/pg-project-engine.ts'],
    trust: 'baseline' as const,
  };

  test('accepts a full commit', () => {
    expect(commitDtoSchema.parse(valid)).toEqual(valid);
  });

  test('accepts every trust level', () => {
    for (const trust of ['baseline', 'preview', 'import']) {
      expect(commitDtoSchema.parse({ ...valid, trust }).trust).toBe(trust);
    }
  });

  test('rejects an invalid trust level', () => {
    expect(() => commitDtoSchema.parse({ ...valid, trust: 'bogus' })).toThrow();
  });

  test('rejects a malformed sha', () => {
    expect(() => commitDtoSchema.parse({ ...valid, sha: 'not-a-sha' })).toThrow();
  });
});
