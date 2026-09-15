/**
 * `importRequestSchema` (SDD-010 "Importador", WO-177).
 */
import { describe, expect, test } from 'vitest';
import { importRequestSchema, MAX_IMPORT_DOCUMENTS } from '../../src/import.js';

const validRequest = {
  schema_version: 1 as const,
  prdmYaml: 'project:\n  id: prj_0000000000000000\n',
  documents: [{ sourcePath: 'docs/prd/PRD-001-x.md', content: '# hi' }],
};

describe('importRequestSchema', () => {
  test('accepts a well-formed request', () => {
    expect(importRequestSchema.parse(validRequest)).toEqual(validRequest);
  });

  test('accepts an optional baselineJson', () => {
    const withBaseline = { ...validRequest, baselineJson: '{"version":1,"docs":{}}' };
    expect(importRequestSchema.parse(withBaseline)).toEqual(withBaseline);
  });

  test('rejects an empty prdmYaml', () => {
    expect(() => importRequestSchema.parse({ ...validRequest, prdmYaml: '' })).toThrow();
  });

  test('rejects more documents than MAX_IMPORT_DOCUMENTS', () => {
    const documents = Array.from({ length: MAX_IMPORT_DOCUMENTS + 1 }, (_, i) => ({ sourcePath: `docs/wo/WO-${i}.md`, content: '' }));
    expect(() => importRequestSchema.parse({ ...validRequest, documents })).toThrow();
  });

  test('rejects an unknown top-level key (strict object)', () => {
    expect(() => importRequestSchema.parse({ ...validRequest, extra: true })).toThrow();
  });
});
