import { describe, expect, test } from 'vitest';
import type { AuthoringService, GraphStore, PrdmConfig, ProjectEngine } from '@prdm/core';
import { requireAuthoring, type PrdmDeps } from '../../src/deps.js';

function fakeDeps(authoring?: AuthoringService): PrdmDeps {
  return {
    config: {} as unknown as PrdmConfig,
    store: {} as unknown as GraphStore,
    engine: {} as unknown as ProjectEngine,
    authoring,
  };
}

/**
 * WO-126/SDD-007: `PrdmDeps.authoring` is optional (a future remote profile omits it entirely); every current
 * caller must go through `requireAuthoring` instead of assuming it is present.
 */
describe('requireAuthoring', () => {
  test('returns the authoring service when present', () => {
    const authoring = { list: () => [] } as unknown as AuthoringService;
    expect(requireAuthoring(fakeDeps(authoring))).toBe(authoring);
  });

  test('throws a clear, non-crashing error when authoring is absent', () => {
    expect(() => requireAuthoring(fakeDeps(undefined))).toThrow(/authoring not available in this profile/);
  });
});
