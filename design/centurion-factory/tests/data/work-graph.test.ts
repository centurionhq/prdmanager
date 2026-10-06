import { describe, expect, it } from 'vitest';
import { FEATURES, getFeature } from '../../src/data/features';
import { BLUEPRINTS, getBlueprint } from '../../src/data/blueprints';
import {
  WORK_ORDERS,
  getWorkOrder,
  workOrdersForFeature,
  workOrderProgress,
} from '../../src/data/workOrders';
import type { FeatureStatus, Station, WorkOrderStatus } from '../../src/data/types';
import { STATIONS } from '../../src/data/types';

const FEATURE_ID = /^(MRD|PRD|FR)-\d{3}$/;
const BLUEPRINT_ID = /^(SDD|ADR)-\d{3}$/;
const WORK_ORDER_ID = /^WO-\d{3}$/;
const SHA = /^[0-9a-f]{7}$/;

const FEATURE_STATUSES: readonly FeatureStatus[] = ['draft', 'proposed', 'approved', 'closed'];
const WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = ['pending', 'in_progress', 'done', 'out_of_sync', 'archived'];

function uniqueIds(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

describe('features', () => {
  it('has exactly 12 features', () => {
    expect(FEATURES).toHaveLength(12);
  });

  it('uses unique ids matching the domain id pattern', () => {
    expect(uniqueIds(FEATURES.map((f) => f.id))).toBe(true);
    for (const feature of FEATURES) expect(feature.id).toMatch(FEATURE_ID);
  });

  it('covers every feature status', () => {
    for (const status of FEATURE_STATUSES) {
      expect(FEATURES.some((f) => f.status === status)).toBe(true);
    }
  });

  it('covers every station', () => {
    for (const station of STATIONS) {
      expect(FEATURES.some((f) => f.station === station)).toBe(true);
    }
  });

  it('keeps closed features at the cierre station', () => {
    for (const feature of FEATURES.filter((f) => f.status === 'closed')) {
      expect(feature.station).toBe<Station>('cierre');
    }
  });

  it('places PRD-006 at the diseno station', () => {
    expect(getFeature('PRD-006')?.station).toBe<Station>('diseno');
  });

  it('resolves every evolvesFrom link to an existing feature', () => {
    for (const feature of FEATURES) {
      if (feature.evolvesFrom) expect(getFeature(feature.evolvesFrom)).toBeDefined();
    }
  });

  it('resolves every blueprintId link to an existing blueprint', () => {
    for (const feature of FEATURES) {
      for (const blueprintId of feature.blueprintIds) expect(getBlueprint(blueprintId)).toBeDefined();
    }
  });

  it('marks the real graph nodes as non-sample and the invented ones as sample', () => {
    expect(getFeature('PRD-001')?.sample).toBe(false);
    expect(getFeature('FR-002')?.sample).toBe(true);
    expect(getFeature('FR-003')?.sample).toBe(true);
  });
});

describe('blueprints', () => {
  it('has exactly 16 blueprints', () => {
    expect(BLUEPRINTS).toHaveLength(16);
  });

  it('uses unique ids matching the domain id pattern', () => {
    expect(uniqueIds(BLUEPRINTS.map((b) => b.id))).toBe(true);
    for (const blueprint of BLUEPRINTS) expect(blueprint.id).toMatch(BLUEPRINT_ID);
  });

  it('resolves every architects entry to an existing feature', () => {
    for (const blueprint of BLUEPRINTS) {
      for (const featureId of blueprint.architects) expect(getFeature(featureId)).toBeDefined();
    }
  });

  it('includes the sample SDD-012 for FR-002', () => {
    const sdd012 = getBlueprint('SDD-012');
    expect(sdd012?.sample).toBe(true);
    expect(sdd012?.architects).toContain('FR-002');
  });
});

describe('work orders', () => {
  it('marks the archived order with its archive metadata, and only archived orders', () => {
    const archived = WORK_ORDERS.filter((w) => w.status === 'archived');
    expect(archived).toHaveLength(1);
    expect(archived[0]?.id).toBe('WO-215');
    expect(archived[0]?.archivedAt).toBeTruthy();
    expect(archived[0]?.archivedBy).toBeTruthy();
    expect(archived[0]?.archiveReason).toBeTruthy();
    for (const wo of WORK_ORDERS.filter((w) => w.status !== 'archived')) expect(wo.archivedAt).toBeUndefined();
  });

  it('has exactly 41 work orders', () => {
    expect(WORK_ORDERS).toHaveLength(41);
  });

  it('uses unique ids matching the domain id pattern', () => {
    expect(uniqueIds(WORK_ORDERS.map((w) => w.id))).toBe(true);
    for (const wo of WORK_ORDERS) expect(wo.id).toMatch(WORK_ORDER_ID);
  });

  it('covers every work order status', () => {
    for (const status of WORK_ORDER_STATUSES) {
      expect(WORK_ORDERS.some((w) => w.status === status)).toBe(true);
    }
  });

  it('resolves every blueprintId and featureId link', () => {
    for (const wo of WORK_ORDERS) {
      expect(getBlueprint(wo.blueprintId)).toBeDefined();
      expect(getFeature(wo.featureId)).toBeDefined();
    }
  });

  it('gives every work order 2-4 criteria ending with the Refs trailer', () => {
    for (const wo of WORK_ORDERS) {
      expect(wo.criteria.length).toBeGreaterThanOrEqual(2);
      expect(wo.criteria.length).toBeLessThanOrEqual(4);
      expect(wo.criteria.at(-1)?.text).toBe(`Commit con el trailer Refs: ${wo.id}`);
    }
  });

  it('gives every work order at least one governed path', () => {
    for (const wo of WORK_ORDERS) expect(wo.governedPaths.length).toBeGreaterThan(0);
  });

  it('gives done work orders at least one 7-char hex commit sha', () => {
    for (const wo of WORK_ORDERS.filter((w) => w.status === 'done')) {
      expect(wo.commitShas.length).toBeGreaterThan(0);
      for (const sha of wo.commitShas) expect(sha).toMatch(SHA);
    }
  });

  it('gives out_of_sync work orders an outOfSyncReason, and only those', () => {
    for (const wo of WORK_ORDERS) {
      if (wo.status === 'out_of_sync') expect(wo.outOfSyncReason).toBeTruthy();
      else expect(wo.outOfSyncReason).toBeUndefined();
    }
  });

  it('gives WO-310 the exact stale-blueprint reason from the canvas', () => {
    expect(getWorkOrder('WO-310')?.outOfSyncReason).toBe(
      'SDD-012 cambió el 15/09 a las 10:02. Revisá los criterios antes de retomar.',
    );
  });

  it('includes the real SDD-011 pending work orders', () => {
    for (const id of ['WO-267', 'WO-275', 'WO-276', 'WO-277']) {
      const wo = getWorkOrder(id);
      expect(wo?.status).toBe<WorkOrderStatus>('pending');
      expect(wo?.blueprintId).toBe('SDD-011');
      expect(wo?.sample).toBe(false);
    }
  });

  it('includes the sample FR-002 work order set', () => {
    const ids = workOrdersForFeature('FR-002').map((w) => w.id).sort();
    expect(ids).toEqual(['WO-301', 'WO-302', 'WO-304', 'WO-307', 'WO-310', 'WO-311']);
  });
});

describe('workOrderProgress', () => {
  it('reports the canvas numbers for FR-002 (14/22, 3 stopped)', () => {
    expect(workOrderProgress('FR-002')).toEqual({ done: 14, total: 22, stopped: 3 });
  });

  it('reports the canvas numbers for PRD-005 (245/245, 0 stopped)', () => {
    expect(workOrderProgress('PRD-005')).toEqual({ done: 245, total: 245, stopped: 0 });
  });

  it('falls back to counting the mock work orders for features without an override', () => {
    const progress = workOrderProgress('PRD-004');
    const wos = workOrdersForFeature('PRD-004');
    expect(progress.total).toBe(wos.length);
    expect(progress.done).toBe(wos.filter((w) => w.status === 'done').length);
  });
});
