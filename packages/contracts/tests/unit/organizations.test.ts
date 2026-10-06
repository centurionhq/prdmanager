/**
 * Organization-member DTO validation (SDD-012, WO-327): adds `lastActiveAt` alongside the existing
 * `projectMemberSchema` extension, so the members screen can show both org- and project-level presence.
 */
import { describe, expect, test } from 'vitest';
import {
  ACCESS_REQUEST_MESSAGE_MAX_LENGTH,
  ACCESS_REQUEST_NAME_MAX_LENGTH,
  accessRequestSchema,
  createAccessRequestInputSchema,
  organizationMemberSchema,
} from '../../src/organizations.js';

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

describe('access requests (SDD-099)', () => {
  test('createAccessRequestInputSchema normalizes the email and leaves absent name/message undefined', () => {
    const parsed = createAccessRequestInputSchema.parse({ email: ' Foo@Bar.COM ' });

    expect(parsed.email).toBe('foo@bar.com');
    expect(parsed.name).toBeUndefined();
    expect(parsed.message).toBeUndefined();
  });

  test('createAccessRequestInputSchema rejects an invalid email', () => {
    expect(createAccessRequestInputSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  test('message accepts exactly the max length and rejects one more', () => {
    const email = 'a@example.com';
    expect(createAccessRequestInputSchema.safeParse({ email, message: 'x'.repeat(ACCESS_REQUEST_MESSAGE_MAX_LENGTH) }).success).toBe(true);
    expect(createAccessRequestInputSchema.safeParse({ email, message: 'x'.repeat(ACCESS_REQUEST_MESSAGE_MAX_LENGTH + 1) }).success).toBe(false);
  });

  test('name accepts exactly the max length and rejects one more', () => {
    const email = 'a@example.com';
    expect(createAccessRequestInputSchema.safeParse({ email, name: 'x'.repeat(ACCESS_REQUEST_NAME_MAX_LENGTH) }).success).toBe(true);
    expect(createAccessRequestInputSchema.safeParse({ email, name: 'x'.repeat(ACCESS_REQUEST_NAME_MAX_LENGTH + 1) }).success).toBe(false);
  });

  test('accessRequestSchema accepts nullable fields and rejects an unknown status', () => {
    const valid = { id: 'r1', email: 'a@example.com', name: null, message: null, status: 'pending', createdAt: '2026-10-06T00:00:00.000Z', resolvedAt: null, resolvedBy: null };

    expect(accessRequestSchema.safeParse(valid).success).toBe(true);
    expect(accessRequestSchema.safeParse({ ...valid, status: 'cancelled' }).success).toBe(false);
  });
});
