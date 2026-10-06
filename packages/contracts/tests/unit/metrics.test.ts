/**
 * Success-metrics DTO validation (SDD-012, WO-327): mirrors `@prdm/core`'s `SuccessMetrics`
 * (`packages/core/src/metrics/metrics.ts`).
 */
import { describe, expect, test } from 'vitest';
import { successMetricsSchema } from '../../src/metrics.js';

describe('successMetricsSchema', () => {
  const valid = {
    agentHumanEfficiency: { completedWorkOrders: 4, measuredWorkOrders: 3, avgResolutionHours: 2.5, medianResolutionHours: 2, unmeasured: { total: 1, workOrders: [{ id: 'WO-009', status: 'done', reason: 'missing_claim', claimedAt: null, completedAt: '2026-01-01T00:00:00.000Z' }] } },
    systemIntegrity: { governedTotal: 10, governedSynced: 8, syncedPercent: 80 },
    traceability: { featuresTotal: 5, featuresTraced: 4, orphanFeatures: [{ id: 'BC-004', kind: 'BC', title: 'Árbol', status: 'approved' }], featurePercent: 80, commitsTotal: 6, commitsWithRefs: 5, commitsTraced: 5, commitPercent: 83.3 },
  };

  test('accepts a full metrics payload', () => {
    expect(successMetricsSchema.parse(valid)).toEqual(valid);
  });

  test('accepts null percents/resolution hours for an empty project', () => {
    const empty = {
      agentHumanEfficiency: { completedWorkOrders: 0, measuredWorkOrders: 0, avgResolutionHours: null, medianResolutionHours: null, unmeasured: { total: 0, workOrders: [] } },
      systemIntegrity: { governedTotal: 0, governedSynced: 0, syncedPercent: null },
      traceability: { featuresTotal: 0, featuresTraced: 0, orphanFeatures: [], featurePercent: null, commitsTotal: 0, commitsWithRefs: 0, commitsTraced: 0, commitPercent: null },
    };
    expect(successMetricsSchema.parse(empty)).toEqual(empty);
  });

  test('requires traceability.orphanFeatures and a title on each item', () => {
    const { orphanFeatures: _orphans, ...withoutOrphans } = valid.traceability;
    expect(() => successMetricsSchema.parse({ ...valid, traceability: withoutOrphans })).toThrow();
    const { title: _title, ...noTitle } = valid.traceability.orphanFeatures[0]!;
    expect(() => successMetricsSchema.parse({ ...valid, traceability: { ...valid.traceability, orphanFeatures: [noTitle] } })).toThrow();
  });

  test('requires agentHumanEfficiency.unmeasured', () => {
    const { unmeasured: _unmeasured, ...withoutUnmeasured } = valid.agentHumanEfficiency;
    expect(() => successMetricsSchema.parse({ ...valid, agentHumanEfficiency: withoutUnmeasured })).toThrow();
  });

  test('rejects an unknown unmeasured reason', () => {
    const bad = { ...valid.agentHumanEfficiency, unmeasured: { total: 1, workOrders: [{ ...valid.agentHumanEfficiency.unmeasured.workOrders[0]!, reason: 'because' }] } };
    expect(() => successMetricsSchema.parse({ ...valid, agentHumanEfficiency: bad })).toThrow();
  });

  test('rejects a missing section', () => {
    const { traceability: _traceability, ...withoutTraceability } = valid;
    expect(() => successMetricsSchema.parse(withoutTraceability)).toThrow();
  });
});
