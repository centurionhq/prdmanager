import { describe, expect, test } from 'vitest';
import { buildLuceneQuery, extractQueryTerms } from '../../src/graph/lucene.js';

describe('extractQueryTerms', () => {
  test('lowercases, drops short tokens and stopwords, and deduplicates', () => {
    expect(extractQueryTerms('The Graph and the graph, with dark mode')).toEqual(['graph', 'dark', 'mode']);
  });

  test('keeps accented letters as part of a term', () => {
    expect(extractQueryTerms('desincronización del código')).toEqual(['desincronización', 'código']);
  });

  test('returns an empty array when only stopwords or short tokens remain', () => {
    expect(extractQueryTerms('the and el la de')).toEqual([]);
  });

  test('caps at 32 distinct terms', () => {
    const text = Array.from({ length: 40 }, (_, i) => `term${i}`).join(' ');
    expect(extractQueryTerms(text)).toHaveLength(32);
  });
});

describe('buildLuceneQuery', () => {
  test('joins extracted terms with OR', () => {
    expect(buildLuceneQuery('dark mode graph')).toBe('dark OR mode OR graph');
  });

  test('returns null when there are no significant terms', () => {
    expect(buildLuceneQuery('the and el la')).toBeNull();
  });

  test('strips characters that could inject Lucene syntax', () => {
    const query = buildLuceneQuery('graph") OR score:99 --');
    expect(query).not.toBeNull();
    expect(query).not.toMatch(/[():"]/);
  });
});
