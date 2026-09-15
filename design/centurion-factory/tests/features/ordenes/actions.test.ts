import { describe, expect, it } from 'vitest';
import type { WorkOrder } from '../../../src/data';
import { completeOrder, isValidCommitSha, retakeOrder, takeOrder } from '../../../src/features/ordenes/actions';

function order(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'WO-311',
    title: 'Test de importación de 2.000 documentos',
    status: 'pending',
    blueprintId: 'SDD-012',
    featureId: 'FR-002',
    objective: 'Objetivo',
    criteria: [],
    governedPaths: [],
    commitShas: [],
    updatedAt: '2026-09-15T08:00:00.000Z',
    sample: true,
    ...overrides,
  };
}

describe('takeOrder', () => {
  it('moves a pending order to in_progress, assigns it and stamps claimedAt', () => {
    const before = order();
    const after = takeOrder(before, 'dev:martin');
    expect(after.status).toBe('in_progress');
    expect(after.assignedTo).toBe('dev:martin');
    expect(after.claimedAt).toBeTruthy();
    expect(before.status).toBe('pending'); // never mutates the input
  });
});

describe('retakeOrder', () => {
  it('moves an out_of_sync order back to in_progress, keeping its assignee', () => {
    const before = order({ status: 'out_of_sync', assignedTo: 'agent:claude', outOfSyncReason: 'SDD-012 cambió.' });
    const after = retakeOrder(before);
    expect(after.status).toBe('in_progress');
    expect(after.assignedTo).toBe('agent:claude');
  });
});

describe('completeOrder', () => {
  it('moves an in_progress order to done and appends the commit sha', () => {
    const before = order({ status: 'in_progress', assignedTo: 'agent:claude', commitShas: ['abc1234'] });
    const after = completeOrder(before, 'deadbee');
    expect(after.status).toBe('done');
    expect(after.commitShas).toEqual(['abc1234', 'deadbee']);
    expect(after.completedAt).toBeTruthy();
    expect(before.commitShas).toEqual(['abc1234']); // never mutates the input array
  });

  it('trims the sha before storing it', () => {
    const after = completeOrder(order({ status: 'in_progress' }), '  deadbee  ');
    expect(after.commitShas).toEqual(['deadbee']);
  });
});

describe('isValidCommitSha', () => {
  it('accepts 7 to 40 hex characters', () => {
    expect(isValidCommitSha('deadbee')).toBe(true);
    expect(isValidCommitSha('a'.repeat(40))).toBe(true);
    expect(isValidCommitSha('  3c1a5af  ')).toBe(true);
  });

  it('rejects anything shorter, longer or non-hex', () => {
    expect(isValidCommitSha('abc12')).toBe(false);
    expect(isValidCommitSha('a'.repeat(41))).toBe(false);
    expect(isValidCommitSha('not-a-sha')).toBe(false);
    expect(isValidCommitSha('')).toBe(false);
  });
});
