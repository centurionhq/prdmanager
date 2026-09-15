import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { LineBoard } from '../../../src/features/planta/LineBoard';

// WO-281: the single orchestrated load reveal. Read the CSS module the way
// tests/no-hardcoded-hex.test.ts reads tokens.css, since jsdom never applies stylesheets.
const css = readFileSync(resolve(import.meta.dirname, '../../../src/features/planta/LineBoard.module.css'), 'utf8');

describe('LineBoard reveal (WO-281)', () => {
  it('marks the board with a reveal attribute', () => {
    render(
      <MemoryRouter>
        <LineBoard />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('La línea').getAttribute('data-reveal')).toBe('line-board');
  });

  it('only animates inside prefers-reduced-motion: no-preference', () => {
    const noPreferenceBlock = css.split('@media (prefers-reduced-motion: no-preference)')[1];
    expect(noPreferenceBlock).toBeTruthy();
    expect(noPreferenceBlock).toMatch(/animation:\s*cf-station/);
    expect(noPreferenceBlock).toMatch(/animation:\s*cf-row/);
    expect(noPreferenceBlock).toMatch(/animation:\s*cf-andon/);
  });

  it('defines the station, row and andon keyframes exactly once each', () => {
    expect(css.match(/@keyframes cf-station/g)).toHaveLength(1);
    expect(css.match(/@keyframes cf-row/g)).toHaveLength(1);
    expect(css.match(/@keyframes cf-andon/g)).toHaveLength(1);
  });

  it('staggers station headers left to right with a CSS custom property per column', () => {
    expect(css).toMatch(/animation-delay:\s*var\(--station-delay/);
  });

  it('staggers rows with a per-row delay and slides them in from -24px', () => {
    expect(css).toMatch(/animation-delay:\s*var\(--row-delay/);
    expect(css).toMatch(/translateX\(-24px\)/);
  });

  it('flashes the andon header last, around 1300ms', () => {
    expect(css).toMatch(/cf-andon 700ms var\(--ease-out\) 1300ms both/);
  });

  it('only declares animation inside the reduced-motion media query', () => {
    const mediaIndex = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    const before = css.slice(0, mediaIndex);
    expect(before).not.toMatch(/animation:/);
    expect(css.match(/animation:\s*cf-/g)).toHaveLength(3);
  });
});
