import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const doc = readFileSync(resolve(import.meta.dirname, '../CLAUDE.md'), 'utf8');
const tokens = readFileSync(resolve(import.meta.dirname, '../src/styles/tokens.css'), 'utf8');

describe('CLAUDE.md design rules', () => {
  it('states the never-hardcode-hex rule', () => {
    expect(doc).toMatch(/Never hardcode hex/);
  });

  it('documents every token with the same value as tokens.css', () => {
    const rows = [...doc.matchAll(/`--([a-z-]+)`(?:\s*\/\s*`--([a-z-]+)`)?\s*\|\s*`(#[0-9A-F]{6})`(?:\s*\/\s*`(#[0-9A-F]{6})`)?/g)];
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const row of rows) {
      const pairs: Array<[string | undefined, string | undefined]> = [
        [row[1], row[3]],
        [row[2], row[4]],
      ];
      for (const [name, hex] of pairs) {
        if (!name || !hex) continue;
        expect(tokens, `--${name}`).toMatch(new RegExp(`--${name}:\\s*${hex};`));
      }
    }
  });

  it('documents the spacing scale that tokens.css defines', () => {
    for (const step of ['space-1', 'space-2', 'space-3', 'space-4', 'space-6', 'space-8', 'space-12']) {
      expect(doc).toContain(`--${step}`);
      expect(tokens).toContain(`--${step}:`);
    }
  });
});
