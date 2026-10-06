/**
 * WO-633 (SDD-069, FB-104): a `toLocale*()` without a locale borrows the *browser's* locale and the runtime's
 * hour cycle. That is how the drift subtitle shipped as `9/27/2026, 6:21:56 PM` in an es-AR product, and it
 * happened in three files at once. Fixing them by hand does not stop the fourth, so the net is a scan.
 *
 * It reads the sources as text: a call like `.toLocaleString()` is legal TypeScript, passes every type and
 * every other test, and only shows up as the wrong words on a screen nobody's CI looks at. Passing a locale
 * (`.toLocaleString('es-AR')`) is fine — the point is not the API, it is deciding the format in the app.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '../../src');

/** `.toLocaleString()`, `.toLocaleDateString()` and `.toLocaleTimeString()` with no argument at all. */
const UNLOCALIZED = /\.toLocale(?:Date|Time)?String\s*\(\s*\)/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** 1-based line numbers of every unlocalized call in `source`. */
function offenders(source: string): number[] {
  return [...source.matchAll(UNLOCALIZED)].map((match) => source.slice(0, match.index).split('\n').length);
}

const files = walk(SRC).filter((file) => /\.tsx?$/.test(file));

describe('locale guard (WO-633, SDD-069)', () => {
  it('detects the bug it exists to prevent', () => {
    expect(offenders('const x = new Date(iso).toLocaleString();')).toEqual([1]);
    expect(offenders('a.toLocaleDateString()\nb.toLocaleTimeString()')).toEqual([1, 2]);
  });

  it('leaves calls that pass a locale alone', () => {
    expect(offenders("new Date(iso).toLocaleString('es-AR')")).toEqual([]);
    expect(offenders("new Date(iso).toLocaleDateString('es-AR')")).toEqual([]);
  });

  it('finds no unlocalized toLocale*() under packages/app/src', () => {
    const found = files.flatMap((file) =>
      offenders(readFileSync(file, 'utf8')).map((line) => `${relative(SRC, file)}:${line}`),
    );
    expect(found).toEqual([]);
  });
});
