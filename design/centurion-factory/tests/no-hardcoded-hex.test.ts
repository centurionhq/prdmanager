import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = resolve(import.meta.dirname, '../src');
const allowed = new Set(['styles/tokens.css']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// SDD-011 / CLAUDE.md: never hardcode hex — every color goes through var(--token).
describe('no hardcoded hex colors', () => {
  const files = walk(srcDir).filter((file) => /\.(css|ts|tsx)$/.test(file));

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('keeps hex values only inside tokens.css', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(srcDir, file).split('\\').join('/');
      if (allowed.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        offenders.push(`${rel}: ${match[0]}`);
      }
      if (/rgba?\(\s*\d/.test(source)) offenders.push(`${rel}: rgb()/rgba() literal`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('base styles', () => {
  const base = readFileSync(join(srcDir, 'styles/base.css'), 'utf8');

  it('shows a visible keyboard focus ring', () => {
    expect(base).toMatch(/:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
  });

  it('turns motion off under prefers-reduced-motion', () => {
    expect(base).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it('uses tabular figures for the .num utility', () => {
    expect(base).toMatch(/\.num\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it('paints the page from tokens', () => {
    expect(base).toMatch(/body\s*\{[^}]*background:\s*var\(--acero\)/);
    expect(base).toMatch(/body\s*\{[^}]*color:\s*var\(--grafito\)/);
  });
});
