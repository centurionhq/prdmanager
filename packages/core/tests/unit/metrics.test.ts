import { describe, expect, test } from 'vitest';
import { computeMetrics, getMetrics } from '../../src/metrics/metrics.js';
import type { MetricsRaw } from '../../src/graph/types.js';

function raw(overrides: Partial<MetricsRaw> = {}): MetricsRaw {
  return {
    governedTotal: 0,
    governedSynced: 0,
    featuresTotal: 0,
    featuresTraced: 0,
    orphanFeatures: [],
    commitsTotal: 0,
    commitsWithRefs: 0,
    commitsTraced: 0,
    workOrders: [],
    ...overrides,
  };
}

describe('computeMetrics', () => {
  test('returns nulls for every percentage/average when denominators are zero', () => {
    const metrics = computeMetrics(raw());

    expect(metrics).toEqual({
      agentHumanEfficiency: { completedWorkOrders: 0, measuredWorkOrders: 0, avgResolutionHours: null, medianResolutionHours: null, unmeasured: { total: 0, workOrders: [] } },
      systemIntegrity: { governedTotal: 0, governedSynced: 0, syncedPercent: null },
      traceability: {
        featuresTotal: 0,
        featuresTraced: 0,
        orphanFeatures: [],
        featurePercent: null,
        commitsTotal: 0,
        commitsWithRefs: 0,
        commitsTraced: 0,
        commitPercent: null,
      },
      pendingQueue: { total: 0, unassigned: 0, oldestDays: null, over7Days: 0 },
    });
  });

  test('copies orphanFeatures as-is and keeps featuresTraced + orphans == featuresTotal', () => {
    const orphan = { id: 'BC-003', kind: 'BC', title: 'Sin linaje', status: 'approved' };
    const mixed = computeMetrics(raw({ featuresTotal: 4, featuresTraced: 3, orphanFeatures: [orphan] })).traceability;
    expect(mixed.orphanFeatures).toEqual([orphan]);
    expect(mixed.featuresTraced + mixed.orphanFeatures.length).toBe(mixed.featuresTotal);

    expect(computeMetrics(raw({ featuresTotal: 2, featuresTraced: 2 })).traceability.featurePercent).toBe(100);
    const allOrphans = computeMetrics(raw({ featuresTotal: 1, featuresTraced: 0, orphanFeatures: [orphan] })).traceability;
    expect(allOrphans.featurePercent).toBe(0);
  });

  test('rounds percentages to 1 decimal', () => {
    const metrics = computeMetrics(raw({ governedTotal: 3, governedSynced: 1, featuresTotal: 7, featuresTraced: 2, commitsTotal: 6, commitsTraced: 1 }));

    expect(metrics.systemIntegrity.syncedPercent).toBe(33.3);
    expect(metrics.traceability.featurePercent).toBe(28.6);
    expect(metrics.traceability.commitPercent).toBe(16.7);
  });

  test('counts completed work orders (done or out_of_sync) regardless of measurability', () => {
    const metrics = computeMetrics(
      raw({
        workOrders: [
          { id: 'WO-001', status: 'done', assignedTo: null, createdAt: null, claimedAt: null, completedAt: null },
          { id: 'WO-002', status: 'todo', assignedTo: null, createdAt: null, claimedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T02:00:00.000Z' },
          { id: 'WO-003', status: 'out_of_sync', assignedTo: null, createdAt: null, claimedAt: null, completedAt: null },
        ],
      }),
    );

    expect(metrics.agentHumanEfficiency.completedWorkOrders).toBe(2);
    expect(metrics.agentHumanEfficiency.measuredWorkOrders).toBe(0);
    expect(metrics.agentHumanEfficiency.avgResolutionHours).toBeNull();
    expect(metrics.agentHumanEfficiency.medianResolutionHours).toBeNull();
  });

  test('ignores invalid, missing, and negative durations when computing resolution time', () => {
    const metrics = computeMetrics(
      raw({
        workOrders: [
          { id: 'WO-001', status: 'done', assignedTo: null, createdAt: null, claimedAt: 'not-a-date', completedAt: '2026-01-01T02:00:00.000Z' },
          { id: 'WO-002', status: 'done', assignedTo: null, createdAt: null, claimedAt: '2026-01-01T02:00:00.000Z', completedAt: null },
          { id: 'WO-003', status: 'done', assignedTo: null, createdAt: null, claimedAt: '2026-01-02T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'WO-004', status: 'done', assignedTo: null, createdAt: null, claimedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T04:00:00.000Z' },
        ],
      }),
    );

    expect(metrics.agentHumanEfficiency.completedWorkOrders).toBe(4);
    expect(metrics.agentHumanEfficiency.measuredWorkOrders).toBe(1);
    expect(metrics.agentHumanEfficiency.avgResolutionHours).toBe(4);
    expect(metrics.agentHumanEfficiency.medianResolutionHours).toBe(4);
  });

  test('computes the median for an odd number of measured work orders', () => {
    const workOrders = [1, 5, 3].map((hours, i) => ({
      id: `WO-00${i}`,
      status: 'done',
      assignedTo: null,
      createdAt: null,
      claimedAt: '2026-01-01T00:00:00.000Z',
      completedAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + hours * 3_600_000).toISOString(),
    }));
    const metrics = computeMetrics(raw({ workOrders }));

    expect(metrics.agentHumanEfficiency.avgResolutionHours).toBe(3);
    expect(metrics.agentHumanEfficiency.medianResolutionHours).toBe(3);
  });

  test('computes the median for an even number of measured work orders', () => {
    const workOrders = [1, 2, 3, 4].map((hours, i) => ({
      id: `WO-00${i}`,
      status: 'done',
      assignedTo: null,
      createdAt: null,
      claimedAt: '2026-01-01T00:00:00.000Z',
      completedAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + hours * 3_600_000).toISOString(),
    }));
    const metrics = computeMetrics(raw({ workOrders }));

    expect(metrics.agentHumanEfficiency.medianResolutionHours).toBe(2.5);
    expect(metrics.agentHumanEfficiency.avgResolutionHours).toBe(2.5);
  });

  test('rounds average resolution hours to 2 decimals', () => {
    const workOrders = [1, 2, 2].map((hours, i) => ({
      id: `WO-00${i}`,
      status: 'done',
      assignedTo: null,
      createdAt: null,
      claimedAt: '2026-01-01T00:00:00.000Z',
      completedAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + hours * 3_600_000).toISOString(),
    }));
    const metrics = computeMetrics(raw({ workOrders }));

    expect(metrics.agentHumanEfficiency.avgResolutionHours).toBe(1.67);
  });
});

describe('computeMetrics unmeasured', () => {
  const wo = (id: string, claimedAt: string | null, completedAt: string | null, status = 'done'): MetricsRaw['workOrders'][number] => ({
    id, status, assignedTo: null, createdAt: null, claimedAt, completedAt,
  });
  const T0 = '2026-01-01T00:00:00.000Z';
  const T1 = '2026-01-01T04:00:00.000Z';

  test('assigns one reason per order and keeps measured + unmeasured == completed', () => {
    const { agentHumanEfficiency: e } = computeMetrics(
      raw({
        workOrders: [
          wo('WO-001', null, T1),
          wo('WO-002', T0, null),
          wo('WO-003', 'not-a-date', T1),
          wo('WO-004', T1, T0, 'out_of_sync'),
          wo('WO-005', T0, T1),
          wo('WO-006', T0, null, 'pending'),
        ],
      }),
    );

    expect(e.unmeasured.workOrders.map((w) => [w.id, w.reason])).toEqual([
      ['WO-001', 'missing_claim'],
      ['WO-002', 'missing_completion'],
      ['WO-003', 'invalid_timestamp'],
      ['WO-004', 'negative_duration'],
    ]);
    expect(e.unmeasured.workOrders[3]).toEqual({ id: 'WO-004', status: 'out_of_sync', reason: 'negative_duration', claimedAt: T1, completedAt: T0 });
    expect(e.unmeasured.total).toBe(4);
    expect(e.measuredWorkOrders + e.unmeasured.total).toBe(e.completedWorkOrders);
    expect(e.avgResolutionHours).toBe(4);
    expect(e.medianResolutionHours).toBe(4);
  });

  test('applies precedence missing_claim > missing_completion > invalid_timestamp > negative_duration', () => {
    const { unmeasured } = computeMetrics(
      raw({ workOrders: [wo('WO-001', '', null), wo('WO-002', 'bad', null), wo('WO-003', 'bad', 'worse'), wo('WO-004', null, 'bad')] }),
    ).agentHumanEfficiency;

    expect(unmeasured.workOrders.map((w) => w.reason)).toEqual(['missing_claim', 'missing_completion', 'invalid_timestamp', 'missing_claim']);
  });

  test('orders unmeasured work orders by id regardless of input order', () => {
    const { unmeasured } = computeMetrics(raw({ workOrders: [wo('WO-010', null, null), wo('WO-002', null, null), wo('WO-007', null, null)] })).agentHumanEfficiency;

    expect(unmeasured.workOrders.map((w) => w.id)).toEqual(['WO-002', 'WO-007', 'WO-010']);
  });

  test('reports an empty gap when every completed order is measured', () => {
    const { unmeasured } = computeMetrics(raw({ workOrders: [wo('WO-001', T0, T1)] })).agentHumanEfficiency;

    expect(unmeasured).toEqual({ total: 0, workOrders: [] });
  });
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const queueWo = (overrides: Partial<MetricsRaw['workOrders'][number]>): MetricsRaw['workOrders'][number] => ({
  id: 'WO-100',
  status: 'pending',
  assignedTo: null,
  createdAt: null,
  claimedAt: null,
  completedAt: null,
  ...overrides,
});

describe('computeMetrics pendingQueue', () => {
  const empty = { total: 0, unassigned: 0, oldestDays: null, over7Days: 0 };

  test('is empty for no work orders and ignores non-pending statuses', () => {
    expect(computeMetrics(raw()).pendingQueue).toEqual(empty);
    const workOrders = ['done', 'in_progress', 'out_of_sync', 'archived'].map((status) => queueWo({ status, createdAt: daysAgo(30) }));
    expect(computeMetrics(raw({ workOrders })).pendingQueue).toEqual(empty);
  });

  test('counts a pending work order without date or owner', () => {
    const metrics = computeMetrics(raw({ workOrders: [queueWo({})] }));
    expect(metrics.pendingQueue).toEqual({ total: 1, unassigned: 1, oldestDays: null, over7Days: 0 });
  });

  test('reports the oldest age and the work orders older than 7 days', () => {
    const workOrders = [
      queueWo({ id: 'WO-1', assignedTo: 'agent:prdm-engineer', createdAt: daysAgo(3) }),
      queueWo({ id: 'WO-2', assignedTo: '', createdAt: daysAgo(10) }),
    ];
    expect(computeMetrics(raw({ workOrders })).pendingQueue).toEqual({ total: 2, unassigned: 1, oldestDays: 10, over7Days: 1 });
  });

  test('treats a future createdAt as age 0', () => {
    const metrics = computeMetrics(raw({ workOrders: [queueWo({ createdAt: daysAgo(-5) })] }));
    expect(metrics.pendingQueue.oldestDays).toBe(0);
    expect(metrics.pendingQueue.over7Days).toBe(0);
  });
});

describe('getMetrics', () => {
  test('delegates to the store and computes metrics from the raw payload', async () => {
    const store = { metricsRaw: async () => raw({ governedTotal: 2, governedSynced: 2 }) };
    const metrics = await getMetrics(store);
    expect(metrics.systemIntegrity.syncedPercent).toBe(100);
  });
});
