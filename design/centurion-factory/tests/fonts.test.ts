import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesDir = resolve(import.meta.dirname, '../src/styles');
const base = readFileSync(join(stylesDir, 'base.css'), 'utf8');
const require = createRequire(import.meta.url);

// ADR-007: fonts are self-hosted through @fontsource, never requested from a network host.
describe('self-hosted fonts', () => {
  const imports = [...base.matchAll(/@import\s+'([^']+)'/g)].map((match) => match[1] as string);

  it('imports Archivo variable with the width axis and IBM Plex Mono from @fontsource', () => {
    expect(imports).toContain('@fontsource-variable/archivo/wdth.css');
    expect(imports).toContain('@fontsource/ibm-plex-mono/400.css');
    expect(imports).toContain('@fontsource/ibm-plex-mono/500.css');
  });

  it('resolves every font import to a local file that uses font-display swap', () => {
    for (const specifier of imports) {
      const file = require.resolve(specifier);
      expect(readFileSync(file, 'utf8')).toContain('font-display: swap');
    }
  });

  it('never references a remote font host in the package styles', () => {
    for (const name of readdirSync(stylesDir)) {
      const css = readFileSync(join(stylesDir, name), 'utf8');
      expect(css, name).not.toMatch(/https?:\/\//);
    }
  });

  it('declares fallback stacks for both families in the tokens', () => {
    const tokens = readFileSync(join(stylesDir, 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--font-sans:\s*'Archivo Variable',[^;]*sans-serif;/);
    expect(tokens).toMatch(/--font-mono:\s*'IBM Plex Mono',[^;]*monospace;/);
  });
});
