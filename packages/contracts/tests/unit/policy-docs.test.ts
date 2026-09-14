/**
 * `policyDocsRequestSchema`/`policyDocsResponseSchema` (SDD-010 "check commits --range remoto",
 * WO-177/WO-183).
 */
import { describe, expect, test } from 'vitest';
import { MAX_POLICY_DOCS_SHAS, policyDocsRequestSchema, policyDocsResponseSchema } from '../../src/policy-docs.js';

describe('policyDocsRequestSchema', () => {
  test('accepts a batch of shas', () => {
    expect(policyDocsRequestSchema.parse({ shas: ['a'.repeat(40), 'b'.repeat(7)] })).toEqual({ shas: ['a'.repeat(40), 'b'.repeat(7)] });
  });

  test('rejects an empty batch', () => {
    expect(() => policyDocsRequestSchema.parse({ shas: [] })).toThrow();
  });

  test('rejects more shas than MAX_POLICY_DOCS_SHAS', () => {
    const shas = Array.from({ length: MAX_POLICY_DOCS_SHAS + 1 }, (_, i) => i.toString(16).padStart(40, '0'));
    expect(() => policyDocsRequestSchema.parse({ shas })).toThrow();
  });

  test('rejects a non-hex sha', () => {
    expect(() => policyDocsRequestSchema.parse({ shas: ['not-a-sha'] })).toThrow();
  });
});

describe('policyDocsResponseSchema', () => {
  test('accepts a batch response', () => {
    const response = {
      results: [{ sha: 'a'.repeat(40), evaluatedAt: '2026-09-14T00:00:00.000Z', documents: [{ id: 'ADR-001', sourcePath: 'docs/adr/ADR-001-x.md', content: '' }] }],
    };
    expect(policyDocsResponseSchema.parse(response)).toEqual(response);
  });
});
