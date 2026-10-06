import { describe, expect, test } from 'vitest';
import type { GraphStore, NodeView } from '../../src/graph/types.js';
import { getWorkOrderContext } from '../../src/workorders/context.js';

const workOrder: NodeView = {
  id: 'WO-001',
  label: 'WorkOrder',
  kind: 'WO',
  title: 'wo',
  status: 'pending',
  body: '',
  tags: [],
  source_path: 'docs/work-orders/WO-001.md',
  mirrorPath: 'ignored-by-context',
  created_at: null,
};

describe('getWorkOrderContext publishes mirrorPath (SDD-074 D4)', () => {
  test('keeps sourcePath canonical and derives mirrorPath from the id', async () => {
    const store = { workOrderContext: async () => ({ workOrder, blueprints: [], features: [], context: [], code: [], commits: [] }) } as unknown as GraphStore;
    const ctx = await getWorkOrderContext(store, 'WO-001');
    expect(ctx?.workOrder.sourcePath).toBe('docs/work-orders/WO-001.md');
    expect(ctx?.workOrder.mirrorPath).toBe('.prdm/remote/docs/WO-001.md');
  });
});

describe('getWorkOrderContext publishes deliverableKind (SDD-093 D5)', () => {
  const contextOf = async (node: NodeView) => {
    const store = { workOrderContext: async () => ({ workOrder: node, blueprints: [], features: [], context: [], code: [], commits: [] }) } as unknown as GraphStore;
    return getWorkOrderContext(store, node.id);
  };

  test('derives gate from the title when the field is not persisted', async () => {
    const ctx = await contextOf({ ...workOrder, title: 'Cierre (verificación, gate)' });
    expect(ctx?.workOrder.deliverableKind).toBe('gate');
  });

  test('the persisted deliverable_kind wins over the title', async () => {
    const ctx = await contextOf({ ...workOrder, title: 'Cierre (verificación, gate)', deliverable_kind: 'code' });
    expect(ctx?.workOrder.deliverableKind).toBe('code');
  });

  test('a plain title without the field is code', async () => {
    const ctx = await contextOf(workOrder);
    expect(ctx?.workOrder.deliverableKind).toBe('code');
  });
});
