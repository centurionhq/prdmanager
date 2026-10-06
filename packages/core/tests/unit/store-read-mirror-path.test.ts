import type { Driver } from 'neo4j-driver';
import { describe, expect, test } from 'vitest';
import { getNode, listWorkOrders, queryWorkOrders } from '../../src/graph/store-read.js';

function fakeDriver(rows: unknown[]): Driver {
  return { executeQuery: async () => ({ records: rows.map((row) => ({ toObject: () => row })) }) } as unknown as Driver;
}

const woRow = { id: 'WO-001', title: 't', status: 'pending', assignedTo: null, blueprints: [], sourcePath: 'docs/work-orders/WO-001.md' };

describe('store-read derives mirrorPath on read (SDD-074 D2/D3)', () => {
  test('listWorkOrders adds mirrorPath and keeps sourcePath intact', async () => {
    const [item] = await listWorkOrders(fakeDriver([woRow]), 'neo4j', 'prj_x', {});
    expect(item?.mirrorPath).toBe('.prdm/remote/docs/WO-001.md');
    expect(item?.sourcePath).toBe('docs/work-orders/WO-001.md');
  });

  test('queryWorkOrders adds mirrorPath to every page item', async () => {
    const page = await queryWorkOrders(fakeDriver([{ items: [woRow], total: 1, statusCounts: {} }]), 'neo4j', 'prj_x', {});
    expect(page.items[0]?.mirrorPath).toBe('.prdm/remote/docs/WO-001.md');
    expect(page.items[0]?.sourcePath).toBe('docs/work-orders/WO-001.md');
    expect(page.total).toBe(1);
  });

  test('getNode publishes mirrorPath next to the original source_path', async () => {
    const node = { id: 'WO-001', label: 'WorkOrder', kind: 'WO', title: 't', status: 'pending', body: '', tags: [], source_path: 'docs/work-orders/WO-001.md', created_at: null };
    const detail = await getNode(fakeDriver([{ node, links: [] }]), 'neo4j', 'prj_x', 'WO-001');
    expect(detail?.node.mirrorPath).toBe('.prdm/remote/docs/WO-001.md');
    expect(detail?.node.source_path).toBe('docs/work-orders/WO-001.md');
  });

  test('getNode still returns null when the node does not exist', async () => {
    expect(await getNode(fakeDriver([]), 'neo4j', 'prj_x', 'WO-404')).toBeNull();
  });
});
