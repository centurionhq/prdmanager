/**
 * Project DTO validation (SDD-006, WO-107): slug/name shape and the create/settings-update input
 * schemas.
 */
import { describe, expect, test } from 'vitest';
import { createProjectInputSchema, projectMemberSchema, projectSlugSchema, updateProjectSettingsInputSchema } from '../../src/projects.js';

describe('projectSlugSchema', () => {
  test('accepts lowercase alphanumeric with single hyphens', () => {
    expect(projectSlugSchema.parse('roadmap-2026')).toBe('roadmap-2026');
  });

  test.each(['Roadmap', 'road map', 'road--map', '-roadmap', 'roadmap-', ''])('rejects %j', (value) => {
    expect(() => projectSlugSchema.parse(value)).toThrow();
  });
});

describe('createProjectInputSchema', () => {
  test('settings is optional and defaults through projectSettingsSchema when provided empty', () => {
    const parsed = createProjectInputSchema.parse({ slug: 'roadmap', name: 'Roadmap', settings: {} });
    expect(parsed.settings?.default_branch).toBe('main');
  });

  test('settings may be omitted entirely', () => {
    const parsed = createProjectInputSchema.parse({ slug: 'roadmap', name: 'Roadmap' });
    expect(parsed.settings).toBeUndefined();
  });

  test('rejects an invalid slug', () => {
    expect(() => createProjectInputSchema.parse({ slug: 'Not Valid', name: 'Roadmap' })).toThrow();
  });
});

describe('updateProjectSettingsInputSchema', () => {
  test('requires settings and validates it fully', () => {
    expect(() => updateProjectSettingsInputSchema.parse({})).toThrow();
    const parsed = updateProjectSettingsInputSchema.parse({ settings: {} });
    expect(parsed.settings.hash_algo_version).toBe(1);
  });
});

describe('projectMemberSchema', () => {
  const valid = { userId: 'user-1', email: 'a@example.com', name: 'Ada', role: 'admin' as const, lastActiveAt: '2026-09-01T00:00:00.000Z' };

  test('accepts a member with a lastActiveAt timestamp', () => {
    expect(projectMemberSchema.parse(valid)).toEqual(valid);
  });

  test('accepts a null lastActiveAt (never active)', () => {
    expect(projectMemberSchema.parse({ ...valid, lastActiveAt: null }).lastActiveAt).toBeNull();
  });

  test('may omit lastActiveAt entirely (older server response)', () => {
    const { lastActiveAt: _lastActiveAt, ...withoutLastActiveAt } = valid;
    expect(projectMemberSchema.parse(withoutLastActiveAt).lastActiveAt).toBeUndefined();
  });
});
