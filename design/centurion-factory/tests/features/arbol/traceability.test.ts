import { describe, expect, it } from 'vitest';
import { getFeature } from '../../../src/data';
import { formatDateEs, recentOrdersForBlueprint, traceabilityFor } from '../../../src/features/arbol/traceability';

describe('traceabilityFor', () => {
  it('reproduces the exact canvas numbers for PRD-004 via the documented override', () => {
    const feature = getFeature('PRD-004');
    if (!feature) throw new Error('PRD-004 missing from mock data');
    const chain = traceabilityFor(feature);
    expect(chain.origin).toEqual(['FB-004']);
    expect(chain.blueprintIds).toEqual(['SDD-005', 'ADR-004']);
    expect(chain.ordersLabel).toBe('37 hechas');
    expect(chain.commitsLabel).toBe('41 con Refs');
    expect(chain.codeLabel).toBe('212 referencias sincronizadas');
    expect(chain.codeInSync).toBe(true);
  });

  it('computes real numbers (no override) for a feature with actual mock work orders and commits', () => {
    const feature = getFeature('PRD-002');
    if (!feature) throw new Error('PRD-002 missing from mock data');
    const chain = traceabilityFor(feature);
    // WO-052 and WO-061 are PRD-002's only sample work orders, both done, both with a commit.
    expect(chain.ordersDone).toBe(2);
    expect(chain.commitsWithRefs).toBe(2);
  });

  it('shows the out-of-sync count in paro when a feature has code drift', () => {
    const feature = getFeature('FR-002');
    if (!feature) throw new Error('FR-002 missing from mock data');
    const chain = traceabilityFor(feature);
    expect(chain.codeInSync).toBe(false);
    expect(chain.codeLabel).toBe('2 fuera de sincronía');
  });

  it('names the first blueprint as the primary one', () => {
    const feature = getFeature('PRD-005');
    if (!feature) throw new Error('PRD-005 missing from mock data');
    expect(traceabilityFor(feature).primaryBlueprintId).toBe('SDD-006');
  });
});

describe('recentOrdersForBlueprint', () => {
  it('returns at most `limit` orders for the blueprint, most recently updated first', () => {
    const orders = recentOrdersForBlueprint('SDD-005', 5);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((order) => order.blueprintId === 'SDD-005')).toBe(true);
    for (let index = 1; index < orders.length; index += 1) {
      const previous = orders[index - 1];
      const current = orders[index];
      if (!previous || !current) continue;
      expect(new Date(previous.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(current.updatedAt).getTime());
    }
  });

  it('returns an empty list for a blueprint with no work orders', () => {
    expect(recentOrdersForBlueprint('ADR-002')).toEqual([]);
  });
});

describe('formatDateEs', () => {
  it('formats an ISO date as dd/mm/yyyy', () => {
    expect(formatDateEs('2026-08-28T15:32:02.636Z')).toBe('28/08/2026');
  });
});
