/**
 * `codeReportToDriftInput` (WO-690, SDD-087): the adapter only wires `lifecycle` through to `DriftInput` —
 * the grandfathering criterion itself lives in `@prdm/core`.
 */
import type { Baseline, LifecycleContext } from '@prdm/core';
import type { CodeReportRequest } from '@prdm/contracts';
import { describe, expect, test } from 'vitest';
import { codeReportToDriftInput } from '../../src/engine/code-report-adapter.js';

const BASELINE = { schemaVersion: 1 } as unknown as Baseline;

const REPORT: CodeReportRequest = {
  schema_version: 1,
  client: { prdm_version: '0.2.0', hash_algo_version: 1 },
  branch: 'main',
  head_sha: 'a'.repeat(40),
  docs_graph_version: '0',
  impacts_hashes: {},
  governed: [],
  governed_warnings: [],
  commits: [],
  dirty: [],
} as CodeReportRequest;

describe('codeReportToDriftInput', () => {
  test('passes lifecycle through to the drift input when given', () => {
    const lifecycle: LifecycleContext = { grandfathered: [{ id: 'PRD-001', hash: '0'.repeat(64) }] };

    const input = codeReportToDriftInput(REPORT, [], BASELINE, lifecycle);

    expect(input.lifecycle).toBe(lifecycle);
  });

  test('leaves lifecycle undefined when none is given', () => {
    const input = codeReportToDriftInput(REPORT, [], BASELINE);

    expect(input.lifecycle).toBeUndefined();
  });
});
