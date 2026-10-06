import type { Driver } from 'neo4j-driver';
import { describe, expect, test } from 'vitest';
import { listWorkOrders, queryWorkOrders } from '../../src/graph/store-read.js';

function fakeDriver(rows: unknown[]): Driver {
  return { executeQuery: async () => ({ records: rows.map((row) => ({ toObject: () => row })) }) } as unknown as Driver;
}

const base = { id: 'WO-001', title: 't', status: 'pending', assignedTo: null, blueprints: [], sourcePath: 'docs/work-orders/WO-001.md' };
const SHA = 'a'.repeat(40);

describe('store-read publishes landedCommitSha (SDD-076 D2)', () => {
  test('listWorkOrders returns the full sha the row carries', async () => {
    const [item] = await listWorkOrders(fakeDriver([{ ...base, landedCommitSha: SHA }]), 'neo4j', 'prj_x', {});
    expect(item?.landedCommitSha).toBe(SHA);
  });

  // Cypher entrega `landed[0]` como null cuando la lista está vacía; el fake imita esa fila.
  test('listWorkOrders returns null when the row has no landed commit', async () => {
    const [item] = await listWorkOrders(fakeDriver([{ ...base, landedCommitSha: null }]), 'neo4j', 'prj_x', {});
    expect(item?.landedCommitSha).toBeNull();
  });

  test('queryWorkOrders stays frozen: items carry no landedCommitSha', async () => {
    const page = await queryWorkOrders(fakeDriver([{ items: [base], total: 1, statusCounts: {} }]), 'neo4j', 'prj_x', {});
    expect(page.items[0]?.landedCommitSha).toBeUndefined();
  });
});
