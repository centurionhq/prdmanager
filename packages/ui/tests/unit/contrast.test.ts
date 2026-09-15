import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOKENS_PATH = join(import.meta.dirname, '..', '..', 'src', 'styles', 'tokens.css');
const CSS = readFileSync(TOKENS_PATH, 'utf8');

/** WCAG relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
}

function contrastRatio(hexA: string, hexB: string): number {
  const [l1, l2] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (l1! + 0.05) / (l2! + 0.05);
}

/** Reads a token's dark-theme (bare `:root`) or light-theme (`prefers-color-scheme: light` block) hex value out of the real tokens.css, so this test can never silently drift from what ships. */
function tokenHex(name: string, theme: 'dark' | 'light'): string {
  const block = theme === 'dark' ? CSS.slice(0, CSS.indexOf('@media')) : CSS.slice(CSS.indexOf('@media'));
  const match = new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`).exec(block);
  if (!match) throw new Error(`token ${name} not found in ${theme} block`);
  return match[1]!.toLowerCase();
}

/**
 * `styles/tokens.css` (F6 accessibility review): `--color-fg-subtle` is what every `StatusState` loading/empty/
 * error message renders as, in both themes — a real regression here silently makes those messages illegible,
 * not just visually duller. Checked against the two surfaces it's actually painted on in this app.
 */
describe('tokens.css meets WCAG AA text contrast (4.5:1) for --color-fg-subtle', () => {
  it('dark theme: against --color-bg and --color-bg-elevated-solid', () => {
    const fg = tokenHex('--color-fg-subtle', 'dark');
    expect(contrastRatio(fg, tokenHex('--color-bg', 'dark'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fg, tokenHex('--color-bg-elevated-solid', 'dark'))).toBeGreaterThanOrEqual(4.5);
  });

  it('light theme: against --color-bg and --color-bg-elevated-solid', () => {
    const fg = tokenHex('--color-fg-subtle', 'light');
    expect(contrastRatio(fg, tokenHex('--color-bg', 'light'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fg, tokenHex('--color-bg-elevated-solid', 'light'))).toBeGreaterThanOrEqual(4.5);
  });
});
