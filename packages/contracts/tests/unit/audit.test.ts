import { describe, expect, test } from 'vitest';
import { auditLogPageSchema } from '../../src/audit.js';

const ENTRY = { id: 'e1', actor: { type: 'user', id: 'u1' }, action: 'wo.claim', target: 'WO-001', metadata: {}, createdAt: '2026-09-20T10:00:00.000Z' };

/** The page both audit endpoints answer with. It is shared so the server and the client cannot disagree about
 * its shape again: they did (`entries` on the wire, `items` in the client) and both audit screens crashed. */
describe('auditLogPageSchema (SDD-056/WO-582)', () => {
  test('is { entries, nextCursor }, the shape the server sends', () => {
    expect(auditLogPageSchema.safeParse({ entries: [ENTRY], nextCursor: 'c1' }).success).toBe(true);
    expect(auditLogPageSchema.safeParse({ entries: [], nextCursor: null }).success).toBe(true);
  });

  test('refuses the shape the client used to assume', () => {
    expect(auditLogPageSchema.safeParse({ items: [ENTRY], nextCursor: null }).success).toBe(false);
  });

  test('refuses a page whose entries are not audit entries', () => {
    expect(auditLogPageSchema.safeParse({ entries: [{ id: 'x' }], nextCursor: null }).success).toBe(false);
  });

  test('needs a cursor field, null when there is no further page', () => {
    expect(auditLogPageSchema.safeParse({ entries: [] }).success).toBe(false);
  });
});
