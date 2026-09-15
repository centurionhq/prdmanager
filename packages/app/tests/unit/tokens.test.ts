import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, '../../src/styles/tokens.css'), 'utf8');

function tokens(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of source.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    map.set(match[1] as string, (match[2] as string).trim());
  }
  return map;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] as number) + 0.7152 * (linear[1] as number) + 0.0722 * (linear[2] as number);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const map = tokens(css);
const hex = (name: string): string => {
  const value = map.get(name);
  if (!value || !/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error(`token --${name} is missing or not a 6-digit hex`);
  return value;
};

// ADR-008 / SDD-011 (canvas approved 15/09/2026): ported verbatim from
// design/centurion-factory/tests/tokens.test.ts against packages/app's own copy of tokens.css, so a future
// edit to either copy that drifts from the approved canvas values fails here too.
describe('design tokens', () => {
  it('defines the six named product colors with their approved values', () => {
    expect(hex('grafito')).toBe('#17191C');
    expect(hex('acero')).toBe('#E9ECEB');
    expect(hex('cianotipo')).toBe('#1F4FA0');
    expect(hex('andon')).toBe('#F5C400');
    expect(hex('senal')).toBe('#1E7F4F');
    expect(hex('paro')).toBe('#B8322A');
  });

  it('defines a darker senal-texto for green text on light backgrounds (senal itself fails AA on acero)', () => {
    expect(contrast(hex('senal'), hex('acero'))).toBeLessThan(4.5);
    expect(hex('senal-texto')).toBe('#19703F');
  });

  it('defines the type, spacing and radius scales', () => {
    for (const name of ['text-xs', 'text-sm', 'text-md', 'text-lg', 'text-xl', 'text-2xl', 'space-1', 'space-2', 'space-3', 'space-4', 'space-6', 'space-8', 'space-12', 'radius-plate', 'radius-input', 'font-sans', 'font-mono']) {
      expect(map.has(name), `--${name}`).toBe(true);
    }
  });

  // Every text/background pair the canvas uses, checked against WCAG AA (4.5:1 normal text, 3:1 large text).
  const normalText: Array<[string, string]> = [
    ['grafito', 'acero'],
    ['grafito', 'superficie'],
    ['texto-secundario', 'acero'],
    ['texto-secundario', 'superficie'],
    ['apagado', 'acero'],
    ['apagado', 'superficie'],
    ['cianotipo', 'acero'],
    ['cianotipo', 'superficie'],
    ['senal', 'superficie'],
    ['senal-texto', 'acero'],
    ['senal-texto', 'superficie'],
    ['senal-texto', 'diff-agregado'],
    ['paro', 'superficie'],
    ['paro', 'acero'],
    ['andon-texto', 'superficie'],
    ['andon-texto', 'acero'],
    ['superficie', 'cianotipo'],
    ['superficie', 'grafito'],
    ['grafito', 'andon'],
    ['linea-texto', 'grafito'],
    ['linea-apagado', 'grafito'],
    ['andon', 'grafito'],
    ['grafito', 'seleccion'],
    ['grafito', 'diff-quitado'],
    ['grafito', 'diff-agregado'],
  ];

  it.each(normalText)('%s on %s meets 4.5:1', (fg, bg) => {
    expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the andon yellow off light backgrounds as text', () => {
    expect(contrast(hex('andon'), hex('acero'))).toBeLessThan(3);
  });

  it('grows --control-height to the 44px hit target below the 767px mobile breakpoint', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{\s*:root\s*\{[^}]*--control-height:\s*var\(--hit-target\)/);
  });
});
