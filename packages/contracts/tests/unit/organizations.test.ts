/**
 * Organization-member DTO validation (SDD-012, WO-327): adds `lastActiveAt` alongside the existing
 * `projectMemberSchema` extension, so the members screen can show both org- and project-level presence.
 */
import { describe, expect, test } from 'vitest';
import { organizationMemberSchema } from '../../src/organizations.js';

describe('organizationMemberSchema', () => {
  const valid = { userId: 'user-1', email: 'a@example.com', name: 'Ada', role: 'owner' as const, lastActiveAt: '2026-09-01T00:00:00.000Z' };

  test('accepts a member with a lastActiveAt timestamp', () => {
    expect(organizationMemberSchema.parse(valid)).toEqual(valid);
  });

  test('accepts a null lastActiveAt (never active)', () => {
    expect(organizationMemberSchema.parse({ ...valid, lastActiveAt: null }).lastActiveAt).toBeNull();
  });

  test('may omit lastActiveAt entirely (older server response)', () => {
    const { lastActiveAt: _lastActiveAt, ...withoutLastActiveAt } = valid;
    expect(organizationMemberSchema.parse(withoutLastActiveAt).lastActiveAt).toBeUndefined();
  });
});
