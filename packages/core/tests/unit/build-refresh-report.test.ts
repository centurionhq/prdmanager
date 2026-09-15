import { describe, expect, test } from 'vitest';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { buildRefreshReport } from '../../src/engine.js';
import { emptyBaseline } from '../../src/sync/baseline.js';
import type { CodeRefState } from '../../src/sync/code-refs.js';
import { detectDrift, type DriftInput } from '../../src/sync/monitor.js';
import { mrd, prd, sdd, wo } from '@prdm/testkit';

const ref = (key: string, hash: string | null): CodeRefState => ({ key, path: key, symbol: null, hash });

function grandfatherAll(docs: readonly ParsedDoc[]): DriftInput['lifecycle'] {
  return { grandfathered: docs.map((d) => ({ id: d.node.id, hash: d.node.contentHash })) };
}

function input(overrides: Partial<DriftInput> & { docs: ParsedDoc[] }): DriftInput {
  return {
    governed: new Map([['SDD-001', [ref('src/sync/a.ts', 'h1')]]]),
    governWarnings: [],
    baseline: emptyBaseline(),
    commits: [],
    dirty: new Set(),
    lifecycle: grandfatherAll(overrides.docs),
    ...overrides,
  };
}

/**
 * WO-123: `buildRefreshReport` was extracted verbatim out of `Engine.doInspect`/`Engine.doRefresh`'s shared
 * `detectDrift(input)` + governed-hash merge. This proves it computes exactly the same `issues`,
 * `workOrderUpdates`, `baseline` and hash-annotated `governed` as manually replaying that original logic against
 * `detectDrift`'s own output, given the same input; Engine's own integration suite (unchanged) proves it still
 * wires together correctly end to end.
 */
describe('buildRefreshReport', () => {
  test('matches detectDrift + the original inline governed-hash merge for the same input', () => {
    const docs = [mrd(), prd(), sdd(), wo('WO-001', 'done')];
    const driftInput = input({ docs });

    const built = buildRefreshReport(driftInput);

    const drift = detectDrift(driftInput);
    const hashByKey = new Map([...driftInput.governed].flatMap(([bp, refs]) => refs.map((r) => [`${bp}|${r.key}`, r.hash] as const)));
    const expectedGoverned = drift.governed.map((g) => ({ ...g, hash: hashByKey.get(`${g.blueprintId}|${g.key}`) ?? null }));

    expect(built.issues).toEqual(drift.issues);
    expect(built.workOrderUpdates).toEqual(drift.workOrderUpdates);
    expect(built.baseline).toEqual(drift.baseline);
    expect(built.reviewNeeded).toEqual(drift.reviewNeeded);
    expect(built.governed).toEqual(expectedGoverned);
    expect(built.governed[0]).toMatchObject({ hash: 'h1' });
  });

  test('is pure: same input always yields deep-equal output', () => {
    const docs = [mrd(), prd(), sdd(), wo('WO-001', 'pending')];
    const driftInput = input({ docs });
    expect(buildRefreshReport(driftInput)).toEqual(buildRefreshReport(driftInput));
  });
});
