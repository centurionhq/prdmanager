/**
 * Redacted audit-log-entry DTO validation (SDD-012, WO-327): mirrors `@prdm/db`'s `audit_log` table
 * (`packages/db/src/schema/audit.ts`), deliberately dropping `ip`/`user_agent`.
 */
import { describe, expect, test } from 'vitest';
import { auditLogEntrySchema } from '../../src/audit.js';

describe('auditLogEntrySchema', () => {
  const valid = {
    id: 'audit-1',
    actor: { type: 'user', id: 'user-1' },
    action: 'project.settings.update',
    target: 'proj-1',
    metadata: { field: 'default_branch' },
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  test('accepts a full entry', () => {
    expect(auditLogEntrySchema.parse(valid)).toEqual(valid);
  });

  test('never carries ip/user_agent even if present on the input', () => {
    const parsed = auditLogEntrySchema.parse({ ...valid, ip: '127.0.0.1', userAgent: 'curl' });
    expect(parsed).not.toHaveProperty('ip');
    expect(parsed).not.toHaveProperty('userAgent');
  });

  test('rejects a missing actor', () => {
    const { actor: _actor, ...withoutActor } = valid;
    expect(() => auditLogEntrySchema.parse(withoutActor)).toThrow();
  });
});
