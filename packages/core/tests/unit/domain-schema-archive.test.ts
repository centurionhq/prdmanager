import { describe, expect, test } from 'vitest';
import { WORK_ORDER_STATUSES, workOrderSchema } from '../../src/domain/schema.js';

/** SDD-018 "Archivado de Work Orders": `archived` is a real WORK_ORDER_STATUSES member, with
 * archived_at/archived_by/archive_reason mirroring the closed_at/closed_by hash-neutral pattern on
 * featureSchema exactly (optional, no default, so their absence never changes an existing document's
 * content hash). */
describe('WORK_ORDER_STATUSES / workOrderSchema archive fields (WO-412)', () => {
  test('archived is a valid work order status', () => {
    expect(WORK_ORDER_STATUSES).toContain('archived');
  });

  const base = { id: 'WO-001', type: 'WO' as const, title: 'Task', implements: ['SDD-001'] };

  test('accepts status: archived with archived_at/archived_by/archive_reason', () => {
    const result = workOrderSchema.safeParse({
      ...base,
      status: 'archived',
      archived_at: '2026-09-17T00:00:00.000Z',
      archived_by: 'dev:tester',
      archive_reason: 'superseded by WO-500',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.archived_at).toBe('2026-09-17T00:00:00.000Z');
      expect(result.data.archived_by).toBe('dev:tester');
      expect(result.data.archive_reason).toBe('superseded by WO-500');
    }
  });

  test('archived_at/archived_by/archive_reason are optional with no default (hash-neutral, mirrors closed_at/closed_by)', () => {
    const result = workOrderSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('archived_at' in result.data).toBe(false);
      expect('archived_by' in result.data).toBe(false);
      expect('archive_reason' in result.data).toBe(false);
    }
  });

  test('rejects an archived_by that does not match ACTOR_PATTERN', () => {
    const result = workOrderSchema.safeParse({ ...base, archived_by: 'not-an-actor' });
    expect(result.success).toBe(false);
  });

  test('accepts an agent: form for archived_by too', () => {
    const result = workOrderSchema.safeParse({ ...base, archived_by: 'agent:claude' });
    expect(result.success).toBe(true);
  });
});
