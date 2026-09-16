/**
 * Search-result DTO validation (SDD-012, WO-327): mirrors the MCP `search_nodes` tool's result shape
 * (`packages/mcp/src/tools-read.ts`, `@prdm/core`'s `SearchHit`).
 */
import { describe, expect, test } from 'vitest';
import { searchHitSchema, searchResultSchema } from '../../src/search.js';

describe('searchHitSchema', () => {
  test('accepts a valid hit', () => {
    const hit = { id: 'PRD-001', label: 'Feature' as const, title: 'Graph Engine', status: 'approved', score: 0.91 };
    expect(searchHitSchema.parse(hit)).toEqual(hit);
  });

  test('rejects an invalid label', () => {
    expect(() => searchHitSchema.parse({ id: 'PRD-001', label: 'Bogus', title: 'x', status: 'approved', score: 1 })).toThrow();
  });
});

describe('searchResultSchema', () => {
  test('accepts an empty results list', () => {
    expect(searchResultSchema.parse({ results: [] })).toEqual({ results: [] });
  });

  test('accepts a populated results list', () => {
    const hit = { id: 'PRD-001', label: 'Feature' as const, title: 'Graph Engine', status: 'approved', score: 0.91 };
    expect(searchResultSchema.parse({ results: [hit] }).results).toHaveLength(1);
  });
});
