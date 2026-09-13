import { describe, expect, test } from 'vitest';
import { parseLegacyConfig } from '../../src/scaffold/adopt.js';

describe('parseLegacyConfig', () => {
  test('parses a full legacy config with defaults applied for missing fields', () => {
    const parsed = parseLegacyConfig(JSON.stringify({ docsDir: 'documentation', ignore: ['tmp/**'], gitMaxCommits: 42 }));
    expect(parsed).toEqual({
      docsDir: 'documentation',
      ignore: ['tmp/**'],
      gitMaxCommits: 42,
      triage: { autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 },
    });
  });

  test('applies every default when the file is an empty object', () => {
    expect(parseLegacyConfig('{}')).toEqual({ docsDir: 'docs', ignore: [], gitMaxCommits: 500, triage: { autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 } });
  });

  test('rejects invalid JSON', () => {
    expect(() => parseLegacyConfig('{ not json')).toThrow(/not valid JSON/);
  });

  test('rejects a schema violation', () => {
    expect(() => parseLegacyConfig(JSON.stringify({ gitMaxCommits: -1 }))).toThrow(/prdm\.config\.json is invalid/);
  });
});
