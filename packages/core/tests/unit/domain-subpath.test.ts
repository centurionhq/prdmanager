import { describe, expect, test } from 'vitest';

/**
 * WO-129/SDD-007: `@prdm/core/domain` must resolve to the browser-safe subpath (only zod schemas/constants/
 * types, no `node:fs`/`neo4j-driver`), and the bare `@prdm/core` alias must still resolve to the full barrel —
 * proving the vitest.config.ts alias ordering (subpath before the bare package) actually works, not just that
 * one of the two happens to resolve.
 */
describe('@prdm/core/domain subpath', () => {
  test('resolves independently of the root @prdm/core barrel and exposes the domain constants', async () => {
    const domain = await import('@prdm/core/domain');
    expect(domain.DOC_KINDS).toEqual(['MRD', 'PRD', 'FR', 'BC', 'SDD', 'ADR', 'WO', 'ART', 'FB']);
    expect(domain.NODE_LABELS).toContain('Feature');
    // The domain subpath must never re-export anything that only exists on the full barrel (e.g. Engine, a node:fs-dependent class).
    expect((domain as Record<string, unknown>).Engine).toBeUndefined();
  });

  test('the bare @prdm/core alias still resolves to the full barrel (both aliases coexist correctly)', async () => {
    const core = await import('@prdm/core');
    expect(core.DOC_KINDS).toEqual(['MRD', 'PRD', 'FR', 'BC', 'SDD', 'ADR', 'WO', 'ART', 'FB']);
    expect(typeof core.Engine).toBe('function');
  });
});
