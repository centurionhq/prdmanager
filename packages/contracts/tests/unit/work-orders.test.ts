/**
 * Work-order context and claim/complete payload DTO validation (SDD-012, WO-327): mirrors
 * `@prdm/core`'s `getWorkOrderContext` result shape (`packages/core/src/workorders/context.ts`).
 */
import { describe, expect, test } from 'vitest';
import { claimWorkOrderInputSchema, completeWorkOrderInputSchema, workOrderContextDtoSchema } from '../../src/work-orders.js';

describe('workOrderContextDtoSchema', () => {
  const valid = {
    workOrder: {
      id: 'WO-001',
      title: 'Leer commits de git',
      status: 'pending',
      assignedTo: null,
      sourcePath: 'docs/work-orders/WO-001.md',
      body: 'Parsear trailers Refs.',
      acceptanceCriteria: ['Implementar hashing de código'],
    },
    blueprints: [{ id: 'SDD-001', title: 'Arquitectura del Sync Monitor', status: 'active', impactsPaths: ['src/sync/**'], body: 'El monitor compara hashes.' }],
    featureLineage: [{ id: 'PRD-001', kind: 'PRD', title: 'Graph Engine', status: 'approved', body: 'Motor de grafos.' }],
    context: [{ id: 'ART-001', label: 'Artifact', title: 'Llamada con cliente', body: 'El cliente pidió alertas.' }],
    code: [{ key: 'src/sync/monitor.ts', path: 'src/sync/monitor.ts', symbol: null, status: 'synced', reason: 'unchanged', blueprint: 'SDD-001' }],
    commits: [{ sha: 'a'.repeat(40), subject: 'feat: sync', author: 'Ada', date: '2026-09-01T00:00:00.000Z' }],
    drift: [],
    instructions: 'Lee el blueprint...',
  };

  test('accepts a full work-order context', () => {
    expect(workOrderContextDtoSchema.parse(valid)).toEqual(valid);
  });

  test('rejects an invalid context label', () => {
    expect(() => workOrderContextDtoSchema.parse({ ...valid, context: [{ ...valid.context[0], label: 'Bogus' }] })).toThrow();
  });
});

describe('claimWorkOrderInputSchema', () => {
  test('accepts an empty object', () => {
    expect(claimWorkOrderInputSchema.parse({})).toEqual({});
  });

  test('rejects an assignee (the server decides)', () => {
    expect(() => claimWorkOrderInputSchema.parse({ assignedTo: 'agent:claude' })).toThrow();
  });
});

describe('completeWorkOrderInputSchema', () => {
  test('accepts a commit sha', () => {
    expect(completeWorkOrderInputSchema.parse({ commitSha: 'a'.repeat(40) })).toEqual({ commitSha: 'a'.repeat(40) });
  });

  test('rejects a missing commit sha', () => {
    expect(() => completeWorkOrderInputSchema.parse({})).toThrow();
  });
});
