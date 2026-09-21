/**
 * WO-574 (SDD-056/PRD-036, FB-035): every `var(--x)` a stylesheet uses must be defined somewhere.
 *
 * An undefined custom property does not fail: the browser silently drops the whole declaration, so a border
 * or a padding simply never happens. That is exactly how `forms.module.css` and `dashboard.module.css` kept
 * compiling, passing every test and shipping while the whole Ajustes section rendered without a single
 * field border -- they were written against a token set (`--color-border`, `--space-md`, ...) that ADR-008
 * stopped loading. A `style={{` grep cannot see that; this can.
 *
 * It is a ratchet, not a wish: `KNOWN_BROKEN` holds exactly the sheets that are broken today, so the test
 * passes now and nobody can *add* an undefined variable while they are being repaired. Each repair removes its
 * sheet from the list (the test also fails if a listed sheet is already clean, so the list can only shrink),
 * and the last one leaves it empty.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '../../src');

/** Sheets known to use variables nobody defines. Shrink it; never grow it. */
const KNOWN_BROKEN: ReadonlySet<string> = new Set(['styles/dashboard.module.css']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(SRC);
const cssFiles = files.filter((file) => file.endsWith('.css'));

/** A custom property counts as defined if any stylesheet declares it, or a component sets it inline
 * (`style={{ '--depth': n }}`). Deliberately global rather than scoped to the cascade: it is a net for the
 * mistake that actually happened (a whole vocabulary that no longer exists), not a cascade simulator. */
const DEFINED = new Set<string>();
for (const file of cssFiles) {
  for (const match of readFileSync(file, 'utf8').matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) DEFINED.add(match[1] as string);
}
for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
  for (const match of readFileSync(file, 'utf8').matchAll(/['"`](--[a-zA-Z0-9_-]+)['"`]\s*:/g)) DEFINED.add(match[1] as string);
}

/** `var(--x)` with no fallback. `var(--x, fallback)` is safe by construction and never counts. */
function undefinedVariables(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Set<string>();
  for (const match of withoutComments.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g)) {
    const name = match[1] as string;
    if (!DEFINED.has(name)) found.add(name);
  }
  return [...found].sort();
}

describe('every CSS custom property in use is defined (WO-574, FB-035)', () => {
  const offenders = new Map<string, string[]>();
  for (const file of cssFiles) {
    const missing = undefinedVariables(readFileSync(file, 'utf8'));
    if (missing.length > 0) offenders.set(relative(SRC, file), missing);
  }

  it('finds the stylesheets and the tokens it checks against', () => {
    expect(cssFiles.length).toBeGreaterThan(20);
    expect(DEFINED.has('--cianotipo')).toBe(true);
    expect(DEFINED.has('--space-4')).toBe(true);
  });

  it('no stylesheet outside the known-broken list uses a variable nobody defines', () => {
    const fresh = [...offenders].filter(([file]) => !KNOWN_BROKEN.has(file));
    expect(fresh.map(([file, missing]) => `${file}: ${missing.join(', ')}`)).toEqual([]);
  });

  it('every sheet on the known-broken list still is broken, so the list can only shrink', () => {
    const repaired = [...KNOWN_BROKEN].filter((file) => !offenders.has(file));
    expect(repaired, `already clean, remove from KNOWN_BROKEN: ${repaired.join(', ')}`).toEqual([]);
  });

  it('detects the failure it exists for (the check itself is not vacuous)', () => {
    expect(undefinedVariables('.a { border: 1px solid var(--color-border); padding: var(--space-md); }')).toEqual(['--color-border', '--space-md']);
    expect(undefinedVariables('.a { border: var(--rule); color: var(--nope, red); }')).toEqual([]);
    expect(undefinedVariables('/* var(--commented-out) */ .a { color: var(--grafito); }')).toEqual([]);
  });
});
