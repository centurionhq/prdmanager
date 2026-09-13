import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { BASELINE_PATH, emptyBaseline, loadBaseline, saveBaseline } from '../../src/sync/baseline.js';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

let root = '';
afterEach(() => root && removeDir(root));

describe('baseline persistence', () => {
  test('loads an empty baseline when missing and saves sorted, stable JSON only when changed', async () => {
    root = makeTmpDir();
    expect(await loadBaseline(root)).toEqual(emptyBaseline());
    const baseline = { version: 1 as const, docs: { 'SDD-001': 'b', 'PRD-001': 'a' }, governs: { 'SDD-001': { 'src/z.ts': 'z', 'src/a.ts': null } } };
    expect(await saveBaseline(root, baseline)).toBe(true);
    const raw = readFileSync(join(root, BASELINE_PATH), 'utf8');
    expect(raw.indexOf('PRD-001')).toBeLessThan(raw.indexOf('SDD-001'));
    expect(raw.indexOf('src/a.ts')).toBeLessThan(raw.indexOf('src/z.ts'));
    expect(raw.endsWith('\n')).toBe(true);
    expect(await loadBaseline(root)).toEqual(baseline);
    expect(await saveBaseline(root, baseline)).toBe(false);
  });

  test('rejects a corrupted baseline file with a clear message', async () => {
    root = makeTmpDir();
    writeFiles(root, { [BASELINE_PATH]: '{"version": 2}' });
    await expect(loadBaseline(root)).rejects.toThrow(/baseline/);
  });
});
