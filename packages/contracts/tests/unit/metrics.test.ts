/**
 * Success-metrics DTO validation (SDD-012, WO-327): mirrors `@prdm/core`'s `SuccessMetrics`
 * (`packages/core/src/metrics/metrics.ts`).
 */
import { describe, expect, test } from 'vitest';
import { successMetricsSchema } from '../../src/metrics.js';

describe('successMetricsSchema', () => {
  const valid = {
    agentHumanEfficiency: { completedWorkOrders: 4, measuredWorkOrders: 3, avgResolutionHours: 2.5, medianResolutionHours: 2, p90ResolutionHours: 373.09, maxResolutionHours: 416.91, slowest: { thresholdHours: 24, total: 115, items: [{ id: 'WO-486', claimedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-18T08:54:36.000Z', resolutionHours: 416.91 }] }, unmeasured: { total: 1, workOrders: [{ id: 'WO-009', status: 'done', reason: 'missing_claim', claimedAt: null, completedAt: '2026-01-01T00:00:00.000Z' }] } },
    systemIntegrity: { governedTotal: 10, governedSynced: 8, syncedPercent: 80 },
    traceability: { featuresByKind: [{ kind: 'MRD', total: 1, traced: 1 }, { kind: 'PRD', total: 2, traced: 1 }, { kind: 'BC', total: 1, traced: 1 }], featuresTotal: 3, featuresTraced: 2, orphanFeatures: [{ id: 'PRD-012', kind: 'PRD', title: 'Árbol', status: 'approved' }], featurePercent: 66.7, commitsTotal: 6, commitsWithRefs: 5, commitsTraced: 5, commitPercent: 83.3, commitsWindow: { branch: 'main', sha: 'abc1234', reportedAt: '2026-10-05T12:00:00.000Z' }, untracedCommits: { total: 1, danglingRefs: 0, byClass: { merge: 0, bookkeeping: 0, code: 1 }, truncated: false, items: [{ sha: 'abc123', subject: 'fix: x', author: 'dev', date: '2026-01-01T00:00:00Z', files: ['a.ts'], gap: 'no_refs', class: 'code' }] } },
  };

  test('accepts a full metrics payload', () => {
    expect(successMetricsSchema.parse(valid)).toEqual(valid);
  });

  test('accepts null percents/resolution hours for an empty project', () => {
    const empty = {
      agentHumanEfficiency: { completedWorkOrders: 0, measuredWorkOrders: 0, avgResolutionHours: null, medianResolutionHours: null, p90ResolutionHours: null, maxResolutionHours: null, slowest: { thresholdHours: 24, total: 0, items: [] }, unmeasured: { total: 0, workOrders: [] } },
      systemIntegrity: { governedTotal: 0, governedSynced: 0, syncedPercent: null },
      traceability: { featuresByKind: [], featuresTotal: 0, featuresTraced: 0, orphanFeatures: [], featurePercent: null, commitsTotal: 0, commitsWithRefs: 0, commitsTraced: 0, commitPercent: null, commitsWindow: { branch: null, sha: null, reportedAt: null }, untracedCommits: { total: 0, danglingRefs: 0, byClass: { merge: 0, bookkeeping: 0, code: 0 }, truncated: false, items: [] } },
    };
    expect(successMetricsSchema.parse(empty)).toEqual(empty);
  });

  test('requires traceability.orphanFeatures and a title on each item', () => {
    const { orphanFeatures: _orphans, ...withoutOrphans } = valid.traceability;
    expect(() => successMetricsSchema.parse({ ...valid, traceability: withoutOrphans })).toThrow();
    const { title: _title, ...noTitle } = valid.traceability.orphanFeatures[0]!;
    expect(() => successMetricsSchema.parse({ ...valid, traceability: { ...valid.traceability, orphanFeatures: [noTitle] } })).toThrow();
  });

  test('requires traceability.featuresByKind', () => {
    const { featuresByKind: _f, ...without } = valid.traceability;
    expect(() => successMetricsSchema.parse({ ...valid, traceability: without })).toThrow();
  });

  test.each([
    ['an unknown kind', { kind: 'XYZ', total: 1, traced: 1 }],
    ['a negative total', { kind: 'PRD', total: -1, traced: 0 }],
    ['a missing traced', { kind: 'PRD', total: 1 }],
  ])('rejects featuresByKind with %s', (_name, entry) => {
    expect(() => successMetricsSchema.parse({ ...valid, traceability: { ...valid.traceability, featuresByKind: [entry] } })).toThrow();
  });

  test('requires agentHumanEfficiency.unmeasured', () => {
    const { unmeasured: _unmeasured, ...withoutUnmeasured } = valid.agentHumanEfficiency;
    expect(() => successMetricsSchema.parse({ ...valid, agentHumanEfficiency: withoutUnmeasured })).toThrow();
  });

  test.each(['p90ResolutionHours', 'maxResolutionHours', 'slowest'] as const)('requires agentHumanEfficiency.%s', (field) => {
    const { [field]: _removed, ...without } = valid.agentHumanEfficiency;
    expect(() => successMetricsSchema.parse({ ...valid, agentHumanEfficiency: without })).toThrow();
  });

  test('rejects a slowest item without resolutionHours or with null claimedAt', () => {
    const item = valid.agentHumanEfficiency.slowest.items[0]!;
    const { resolutionHours: _hours, ...noHours } = item;
    const withItem = (bad: unknown) => ({ ...valid, agentHumanEfficiency: { ...valid.agentHumanEfficiency, slowest: { ...valid.agentHumanEfficiency.slowest, items: [bad] } } });
    expect(() => successMetricsSchema.parse(withItem(noHours))).toThrow();
    expect(() => successMetricsSchema.parse(withItem({ ...item, claimedAt: null }))).toThrow();
  });

  test('rejects an unknown unmeasured reason', () => {
    const bad = { ...valid.agentHumanEfficiency, unmeasured: { total: 1, workOrders: [{ ...valid.agentHumanEfficiency.unmeasured.workOrders[0]!, reason: 'because' }] } };
    expect(() => successMetricsSchema.parse({ ...valid, agentHumanEfficiency: bad })).toThrow();
  });

  test('requires traceability.untracedCommits and a valid gap on each item', () => {
    const { untracedCommits: _untraced, ...withoutUntraced } = valid.traceability;
    expect(() => successMetricsSchema.parse({ ...valid, traceability: withoutUntraced })).toThrow();
    const item = { ...valid.traceability.untracedCommits.items[0]!, gap: 'otro' };
    const badGap = { ...valid.traceability, untracedCommits: { ...valid.traceability.untracedCommits, items: [item] } };
    expect(() => successMetricsSchema.parse({ ...valid, traceability: badGap })).toThrow();
  });

  test('rejects a missing section', () => {
    const { traceability: _traceability, ...withoutTraceability } = valid;
    expect(() => successMetricsSchema.parse(withoutTraceability)).toThrow();
  });

  describe('commitsWindow / byClass (SDD-095)', () => {
    const withTrace = (patch: Record<string, unknown>) => ({ ...valid, traceability: { ...valid.traceability, ...patch } });
    const untracedWith = (patch: Record<string, unknown>) => withTrace({ untracedCommits: { ...valid.traceability.untracedCommits, ...patch } });

    test('rejects a payload without commitsWindow or byClass', () => {
      const { commitsWindow: _w, ...noWindow } = valid.traceability;
      expect(() => successMetricsSchema.parse({ ...valid, traceability: noWindow })).toThrow();
      const { byClass: _b, ...noByClass } = valid.traceability.untracedCommits;
      expect(() => successMetricsSchema.parse(withTrace({ untracedCommits: noByClass }))).toThrow();
    });

    test('rejects an item without class or with an unknown class', () => {
      const item = valid.traceability.untracedCommits.items[0]!;
      const { class: _c, ...noClass } = item;
      expect(() => successMetricsSchema.parse(untracedWith({ items: [noClass] }))).toThrow();
      expect(() => successMetricsSchema.parse(untracedWith({ items: [{ ...item, class: 'otro' }] }))).toThrow();
    });

    test('rejects a non-string window field', () => {
      expect(() => successMetricsSchema.parse(withTrace({ commitsWindow: { branch: 1, sha: null, reportedAt: null } }))).toThrow();
    });

    test.each([-1, 1.5])('rejects byClass.merge = %s', (merge) => {
      expect(() => successMetricsSchema.parse(untracedWith({ byClass: { merge, bookkeeping: 0, code: 1 } }))).toThrow();
    });
  });
});
