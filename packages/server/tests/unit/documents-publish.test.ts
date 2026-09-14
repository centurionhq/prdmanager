/**
 * WO-138 — `generateWorkOrdersFor`/`publishedStatus`/`isBlueprintKind`: pure/near-pure helpers from
 * `../../src/api/documents-publish.ts`, tested directly against a fake `ProjectEngine` so a
 * `generateWorkOrders` failure's "surfaced, never thrown" contract doesn't need real Postgres/Neo4j.
 */
import type { EngineOps, ProjectEngine } from '@prdm/core';
import { describe, expect, test } from 'vitest';
import { generateWorkOrdersFor, isBlueprintKind, publishedStatus } from '../../src/api/documents-publish.js';

describe('isBlueprintKind', () => {
  test('true only for SDD/ADR', () => {
    expect(isBlueprintKind('SDD')).toBe(true);
    expect(isBlueprintKind('ADR')).toBe(true);
    expect(isBlueprintKind('PRD')).toBe(false);
    expect(isBlueprintKind('WO')).toBe(false);
  });
});

describe('publishedStatus', () => {
  test('Feature kinds become approved', () => {
    expect(publishedStatus('MRD', 'draft')).toBe('approved');
    expect(publishedStatus('PRD', 'draft')).toBe('approved');
    expect(publishedStatus('FR', 'draft')).toBe('approved');
  });

  test('Blueprint/Artifact kinds become active', () => {
    expect(publishedStatus('SDD', 'draft')).toBe('active');
    expect(publishedStatus('ADR', 'draft')).toBe('active');
    expect(publishedStatus('ART', 'draft')).toBe('active');
  });

  test('Feedback keeps its current status (no server-managed override), defaulting to "new"', () => {
    expect(publishedStatus('FB', 'triaged')).toBe('triaged');
    expect(publishedStatus('FB', undefined)).toBe('new');
  });
});

describe('generateWorkOrdersFor', () => {
  function fakeEngine(transaction: ProjectEngine['transaction']): ProjectEngine {
    return {
      settings: {} as ProjectEngine['settings'],
      store: {} as ProjectEngine['store'],
      transaction,
      refresh: async () => ({ documents: 0, errors: [], issues: [], governed: [], workOrderUpdates: [], baselineWritten: false, hasBlockingIssues: false }),
      inspect: async () => ({ documents: 0, errors: [], issues: [], governed: [], workOrderUpdates: [], baselineWritten: false, hasBlockingIssues: false }),
      lastReport: async () => null,
      acknowledge: async () => ({ documents: 0, errors: [], issues: [], governed: [], workOrderUpdates: [], baselineWritten: false, hasBlockingIssues: false }),
      recover: async () => ({ recovered: false, warnings: [] }),
      scan: async () => ({ docs: [], errors: [], ids: [] }),
    };
  }

  test('never throws: a generateWorkOrders failure is reported as {generated:false, error}', async () => {
    const engine = fakeEngine(async () => {
      throw new Error('SDD-001 fails its lifecycle design rule and cannot generate work orders: needs impacts_paths');
    });

    const result = await generateWorkOrdersFor(engine, 'SDD-001');

    expect(result).toEqual({ generated: false, created: 0, error: expect.stringContaining('lifecycle design rule') });
  });

  test('surfaces generateWorkOrders own "blueprint not found" error the same way (never a different shape)', async () => {
    const engine = fakeEngine((async (fn: (ops: EngineOps) => unknown) => {
      const ops = { scan: async () => ({ docs: [], errors: [], ids: [] }) } as unknown as EngineOps;
      return fn(ops);
    }) as ProjectEngine['transaction']);

    const result = await generateWorkOrdersFor(engine, 'SDD-999');

    expect(result.generated).toBe(false);
    expect(result.created).toBe(0);
    expect(result.error).toContain('SDD-999');
  });
});
