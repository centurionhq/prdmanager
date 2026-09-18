/**
 * `governanceResponseSchema` (SDD-010 "MCP remoto", WO-177/WO-178).
 */
import { describe, expect, test } from 'vitest';
import { governanceResponseSchema, governanceDocumentSchema, MAX_GOVERNANCE_DOCUMENTS } from '../../src/governance.js';

describe('governanceDocumentSchema', () => {
  test('accepts a well-formed document', () => {
    expect(governanceDocumentSchema.parse({ id: 'PRD-001', sourcePath: 'docs/prd/PRD-001-x.md', content: '# hi' })).toEqual({
      id: 'PRD-001',
      sourcePath: 'docs/prd/PRD-001-x.md',
      content: '# hi',
    });
  });

  test('rejects an invalid document id', () => {
    expect(() => governanceDocumentSchema.parse({ id: 'not-an-id', sourcePath: 'x', content: '' })).toThrow();
  });

  test('SDD-026: accepts a BC id (DOC_ID_PATTERN missed it when SDD-022/WO-433 added the kind)', () => {
    expect(governanceDocumentSchema.parse({ id: 'BC-001', sourcePath: 'docs/business-case/BC-001-x.md', content: '# hi' })).toEqual({
      id: 'BC-001',
      sourcePath: 'docs/business-case/BC-001-x.md',
      content: '# hi',
    });
  });

  test('rejects an unknown key (strict object)', () => {
    expect(() => governanceDocumentSchema.parse({ id: 'PRD-001', sourcePath: 'x', content: '', extra: 1 })).toThrow();
  });
});

describe('governanceResponseSchema', () => {
  const base = { graphVersion: '0', settings: {}, documents: [] };

  test('accepts a minimal response, defaulting settings', () => {
    const parsed = governanceResponseSchema.parse(base);
    expect(parsed.settings.default_branch).toBe('main');
    expect(parsed.documents).toEqual([]);
  });

  test('rejects a non-decimal graphVersion', () => {
    expect(() => governanceResponseSchema.parse({ ...base, graphVersion: 'abc' })).toThrow();
  });

  test('rejects more documents than MAX_GOVERNANCE_DOCUMENTS', () => {
    const documents = Array.from({ length: MAX_GOVERNANCE_DOCUMENTS + 1 }, (_, i) => ({
      id: `WO-${100000 + i}`,
      sourcePath: `docs/wo/WO-${100000 + i}.md`,
      content: '',
    }));
    expect(() => governanceResponseSchema.parse({ ...base, documents })).toThrow();
  });
});
