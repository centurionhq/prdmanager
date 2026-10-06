import type { Driver } from 'neo4j-driver';
import { describe, expect, test } from 'vitest';
import { listWorkOrders, queryWorkOrders } from '../../src/graph/store-read.js';

function fakeDriver(rows: unknown[]): Driver {
  return { executeQuery: async () => ({ records: rows.map((row) => ({ toObject: () => row })) }) } as unknown as Driver;
}

const base = { id: 'WO-001', title: 't', status: 'pending', assignedTo: null, blueprints: [], sourcePath: 'docs/work-orders/WO-001.md' };

describe('store-read publishes dates and age (SDD-075 D1)', () => {
  test('listWorkOrders returns createdAt/claimedAt as they arrive and derives ageDays', async () => {
    const row = { ...base, createdAt: '2020-01-01', claimedAt: '2026-10-06T03:37:41.794Z' };
    const [item] = await listWorkOrders(fakeDriver([row]), 'neo4j', 'prj_x', {});
    expect(item?.createdAt).toBe('2020-01-01');
    expect(item?.claimedAt).toBe('2026-10-06T03:37:41.794Z');
    expect(item?.ageDays).toBeGreaterThan(2000);
    expect(item?.mirrorPath).toBe('.prdm/remote/docs/WO-001.md');
  });

  test('listWorkOrders returns null in the three fields for a row without dates', async () => {
    const [item] = await listWorkOrders(fakeDriver([{ ...base, createdAt: null, claimedAt: null }]), 'neo4j', 'prj_x', {});
    expect(item?.createdAt).toBeNull();
    expect(item?.claimedAt).toBeNull();
    expect(item?.ageDays).toBeNull();
  });

  test('queryWorkOrders stays frozen: no ageDays, mirrorPath kept', async () => {
    const page = await queryWorkOrders(fakeDriver([{ items: [base], total: 1, statusCounts: {} }]), 'neo4j', 'prj_x', {});
    expect(page.items[0]?.ageDays).toBeUndefined();
    expect(page.items[0]?.mirrorPath).toBe('.prdm/remote/docs/WO-001.md');
  });
});
