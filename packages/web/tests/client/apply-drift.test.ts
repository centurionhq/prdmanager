import type { RefreshReport } from '@prdm/core';
import type { EdgeDefinition, NodeDefinition } from 'cytoscape';
import { describe, expect, it } from 'vitest';
import { applyDrift } from '../../src/client/graph/apply-drift';

function makeReport(overrides: Partial<RefreshReport> = {}): RefreshReport {
  return {
    documents: 0,
    errors: [],
    issues: [],
    governed: [],
    workOrderUpdates: [],
    baselineWritten: false,
    hasBlockingIssues: false,
    ...overrides,
  };
}

describe('applyDrift', () => {
  it('badges a node element whose id matches a DriftIssue.nodeId', () => {
    const elements: NodeDefinition[] = [{ group: 'nodes', data: { id: 'FR-001', label: 'Feature' } }];
    const report = makeReport({
      issues: [{ kind: 'code_out_of_sync', severity: 'error', nodeId: 'FR-001', message: 'drift' }],
    });

    expect(applyDrift(elements, report)).toEqual([
      { group: 'nodes', data: { id: 'FR-001', label: 'Feature', drift: true } },
    ]);
  });

  it('badges an element whose id matches a governed code ref path', () => {
    const elements: NodeDefinition[] = [{ group: 'nodes', data: { id: 'src/app.ts' } }];
    const report = makeReport({
      governed: [{ blueprintId: 'SDD-005', key: 'src/app.ts', path: 'src/app.ts', symbol: null, status: 'out_of_sync', reason: 'code_changed', hash: null }],
    });

    expect(applyDrift(elements, report)[0]?.data.drift).toBe(true);
  });

  it('leaves an unaffected element unchanged, by reference', () => {
    const elements: NodeDefinition[] = [{ group: 'nodes', data: { id: 'FR-002' } }];
    const report = makeReport();

    const result = applyDrift(elements, report);
    expect(result[0]).toBe(elements[0]);
    expect(result[0]?.data.drift).toBeUndefined();
  });

  it('does not mutate the input elements', () => {
    const elements: NodeDefinition[] = [{ group: 'nodes', data: { id: 'FR-001' } }];
    const report = makeReport({
      issues: [{ kind: 'code_out_of_sync', severity: 'error', nodeId: 'FR-001', message: 'drift' }],
    });

    applyDrift(elements, report);
    expect(elements[0]?.data.drift).toBeUndefined();
  });

  it('ignores an element with no data.id', () => {
    const elements: EdgeDefinition[] = [{ group: 'edges', data: { source: 'a', target: 'b' } }];
    const report = makeReport({
      issues: [{ kind: 'code_out_of_sync', severity: 'error', nodeId: 'a', message: 'drift' }],
    });

    expect(applyDrift(elements, report)[0]?.data.drift).toBeUndefined();
  });

  it('returns an empty array unchanged', () => {
    expect(applyDrift([], makeReport())).toEqual([]);
  });
});
