/**
 * `projectSettingsSchema` (SDD-006 §Modelo de datos, WO-107): validates the `.prdm.yaml`-shaped subset
 * stored in `projects.settings`.
 */
import { describe, expect, test } from 'vitest';
import { projectSettingsSchema } from '../../src/project-settings.js';

describe('projectSettingsSchema', () => {
  test('an empty object gets every field defaulted', () => {
    const parsed = projectSettingsSchema.parse({});
    expect(parsed).toEqual({
      folders: {},
      ignore: [],
      git: { max_commits: 500, enforce_refs: true, enforce_refs_since: null },
      triage: { auto_link_min_score: 0.5, auto_link_margin: 1.05, max_candidates: 5, min_matched_terms: 2 },
      lifecycle: { grandfathered: [] },
      default_branch: 'main',
      github_repository: null,
      github_repository_id: null,
      github_owner_id: null,
      hash_algo_version: 1,
    });
  });

  test('accepts a fully populated settings object', () => {
    const input = {
      folders: { PRD: 'docs/prd', SDD: 'docs/sdd' },
      ignore: ['node_modules/**'],
      git: { max_commits: 100, enforce_refs: false, enforce_refs_since: 'abc1234' },
      triage: { auto_link_min_score: 0.7, auto_link_margin: 1.1, max_candidates: 10, min_matched_terms: 3 },
      lifecycle: { grandfathered: [{ id: 'PRD-001', hash: 'a'.repeat(64) }] },
      default_branch: 'trunk',
      github_repository: 'acme/widgets',
      github_repository_id: 123,
      github_owner_id: 456,
      hash_algo_version: 2,
    };
    expect(projectSettingsSchema.parse(input)).toEqual(input);
  });

  test('rejects an unknown top-level key (strict object)', () => {
    expect(() => projectSettingsSchema.parse({ neo4j_password: 'x' })).toThrow();
  });

  test('rejects a malformed github_repository (not owner/repo)', () => {
    expect(() => projectSettingsSchema.parse({ github_repository: 'not-a-repo' })).toThrow();
  });

  test('rejects an invalid grandfathered doc id', () => {
    expect(() => projectSettingsSchema.parse({ lifecycle: { grandfathered: [{ id: 'not-an-id', hash: 'a'.repeat(64) }] } })).toThrow();
  });

  test('rejects a grandfathered hash that is not 64 hex characters', () => {
    expect(() => projectSettingsSchema.parse({ lifecycle: { grandfathered: [{ id: 'PRD-001', hash: 'short' }] } })).toThrow();
  });

  test('rejects a negative or zero hash_algo_version', () => {
    expect(() => projectSettingsSchema.parse({ hash_algo_version: 0 })).toThrow();
    expect(() => projectSettingsSchema.parse({ hash_algo_version: -1 })).toThrow();
  });
});
