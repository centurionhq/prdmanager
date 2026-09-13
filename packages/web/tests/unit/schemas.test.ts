import { describe, expect, test } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { idParamsSchema, parseOrThrow, searchQuerySchema, treeQuerySchema, workOrdersQuerySchema } from '../../src/schemas.js';

describe('idParamsSchema', () => {
  test('accepts a well-formed document id', () => {
    expect(parseOrThrow(idParamsSchema, { id: 'PRD-001' })).toEqual({ id: 'PRD-001' });
  });

  test('rejects a malformed id with a ValidationError', () => {
    expect(() => parseOrThrow(idParamsSchema, { id: 'not-an-id' })).toThrow(ValidationError);
  });
});

describe('searchQuerySchema', () => {
  test('requires q between 1 and 200 chars', () => {
    expect(() => parseOrThrow(searchQuerySchema, { q: '' })).toThrow(ValidationError);
    expect(() => parseOrThrow(searchQuerySchema, { q: 'x'.repeat(201) })).toThrow(ValidationError);
    expect(parseOrThrow(searchQuerySchema, { q: 'grafo' })).toMatchObject({ q: 'grafo', limit: 10 });
  });

  test('defaults limit to 10 and clamps to 1..100', () => {
    expect(parseOrThrow(searchQuerySchema, { q: 'x' })).toMatchObject({ limit: 10 });
    expect(parseOrThrow(searchQuerySchema, { q: 'x', limit: '50' })).toMatchObject({ limit: 50 });
    expect(() => parseOrThrow(searchQuerySchema, { q: 'x', limit: '0' })).toThrow(ValidationError);
    expect(() => parseOrThrow(searchQuerySchema, { q: 'x', limit: '101' })).toThrow(ValidationError);
  });

  test('parses a labels CSV against NODE_LABELS', () => {
    expect(parseOrThrow(searchQuerySchema, { q: 'x', labels: 'Feature,Blueprint' })).toMatchObject({ labels: ['Feature', 'Blueprint'] });
  });

  test('rejects an unknown label instead of silently dropping it', () => {
    expect(() => parseOrThrow(searchQuerySchema, { q: 'x', labels: 'Feature,NotALabel' })).toThrow(ValidationError);
  });

  test('leaves labels undefined when omitted', () => {
    expect(parseOrThrow(searchQuerySchema, { q: 'x' }).labels).toBeUndefined();
  });
});

describe('treeQuerySchema', () => {
  test('root is optional', () => {
    expect(parseOrThrow(treeQuerySchema, {})).toEqual({ root: undefined });
  });

  test('root must be a well-formed id when present', () => {
    expect(parseOrThrow(treeQuerySchema, { root: 'PRD-001' })).toEqual({ root: 'PRD-001' });
    expect(() => parseOrThrow(treeQuerySchema, { root: 'nope' })).toThrow(ValidationError);
  });
});

describe('workOrdersQuerySchema', () => {
  test('status must be one of WORK_ORDER_STATUSES', () => {
    expect(parseOrThrow(workOrdersQuerySchema, { status: 'pending' })).toMatchObject({ status: 'pending' });
    expect(() => parseOrThrow(workOrdersQuerySchema, { status: 'bogus' })).toThrow(ValidationError);
  });

  test('blueprint must be a well-formed id when present', () => {
    expect(parseOrThrow(workOrdersQuerySchema, { blueprint: 'SDD-001' })).toMatchObject({ blueprint: 'SDD-001' });
    expect(() => parseOrThrow(workOrdersQuerySchema, { blueprint: 'nope' })).toThrow(ValidationError);
  });

  test('both filters are optional', () => {
    expect(parseOrThrow(workOrdersQuerySchema, {})).toEqual({ status: undefined, blueprint: undefined });
  });
});
