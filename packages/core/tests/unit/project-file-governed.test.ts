import { describe, expect, test } from 'vitest';
import { parseGovernedSettings } from '@prdm/core';

function validRaw(): Record<string, unknown> {
  return {
    folders: { PRD: 'docs/prd' },
    ignore: ['**/*.tmp'],
    git: { max_commits: 200, enforce_refs: true, enforce_refs_since: null },
    triage: { auto_link_min_score: 0.6, auto_link_margin: 1.1, max_candidates: 3, min_matched_terms: 1 },
    lifecycle: { grandfathered: [{ id: 'PRD-001', hash: '0'.repeat(64) }] },
  };
}

describe('parseGovernedSettings (SDD-010, WO-190)', () => {
  test('validates and normalizes a server governance settings payload', () => {
    const settings = parseGovernedSettings(validRaw());
    expect(settings.docsDir).toBe('docs');
    expect(settings.folders.PRD).toBe('docs/prd');
    expect(settings.git).toEqual({ maxCommits: 200, enforceRefs: true, enforceRefsSince: null });
    expect(settings.triage).toEqual({ autoLinkMinScore: 0.6, autoLinkMargin: 1.1, maxCandidates: 3, minMatchedTerms: 1 });
    expect(settings.lifecycle.grandfathered).toEqual([{ id: 'PRD-001', hash: '0'.repeat(64) }]);
  });

  test('fills in every default identically to a local .prdm.yaml missing the same fields', () => {
    const settings = parseGovernedSettings({ folders: {}, ignore: [], git: {}, triage: {}, lifecycle: {} });
    expect(settings.git).toEqual({ maxCommits: 500, enforceRefs: true, enforceRefsSince: null });
    expect(settings.folders.SDD).toBe('docs/sdd');
  });

  test('rejects an unknown field (strict schema, same rules as .prdm.yaml)', () => {
    expect(() => parseGovernedSettings({ ...validRaw(), extra: 'nope' })).toThrow(/invalid governed settings/);
  });

  test('rejects a folder path that escapes its docsDir prefix', () => {
    expect(() => parseGovernedSettings({ ...validRaw(), folders: { PRD: 'elsewhere/prd' } })).toThrow(/must be inside "docs"/);
  });

  test('rejects a malformed grandfathered hash', () => {
    expect(() => parseGovernedSettings({ ...validRaw(), lifecycle: { grandfathered: [{ id: 'PRD-001', hash: 'not-a-hash' }] } })).toThrow(/invalid governed settings/);
  });
});
