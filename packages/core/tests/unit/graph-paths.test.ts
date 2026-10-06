import { describe, expect, test } from 'vitest';
import { MIRROR_DOCS_DIR, mirrorPathFor } from '../../src/graph/paths.js';

describe('mirrorPathFor (SDD-074 D1)', () => {
  test('derives the readable mirror path for a work order', () => {
    expect(mirrorPathFor('WO-649')).toBe('.prdm/remote/docs/WO-649.md');
  });

  test('derives the readable mirror path for another kind', () => {
    expect(mirrorPathFor('PRD-001')).toBe('.prdm/remote/docs/PRD-001.md');
  });

  test('exposes the mirror docs dir convention', () => {
    expect(MIRROR_DOCS_DIR).toBe('.prdm/remote/docs');
  });
});
