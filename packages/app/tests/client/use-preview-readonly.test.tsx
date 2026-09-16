/**
 * WO-382 — `usePreviewReadOnly` bundles the mobile-breakpoint check (`useMediaQuery`, same 767px
 * breakpoint the rest of the app uses) with `isPreviewReadOnly`'s other conditions.
 */
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePreviewReadOnly } from '../../src/editor/use-preview-readonly.js';
import type { PreviewReadOnlyInputs } from '../../src/editor/preview-readonly.js';

/** Simulates `window.matchMedia` matching (or not) the app's 767px mobile breakpoint. */
function mockMobileMediaQuery(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

function Probe(props: Omit<PreviewReadOnlyInputs, 'isMobile'>): ReactElement {
  const readOnly = usePreviewReadOnly(props);
  return <span data-testid="result">{String(readOnly)}</span>;
}

const CONNECTED_EDITABLE = { collabScope: 'read-write' as const, connectionStatus: 'connected' as const, isGenerated: false, isArchived: false };

describe('usePreviewReadOnly', () => {
  it('is false on desktop when nothing else forces read-only', () => {
    mockMobileMediaQuery(false);
    render(<Probe {...CONNECTED_EDITABLE} />);
    expect(screen.getByTestId('result').textContent).toBe('false');
  });

  it('is true on a mobile viewport', () => {
    mockMobileMediaQuery(true);
    render(<Probe {...CONNECTED_EDITABLE} />);
    expect(screen.getByTestId('result').textContent).toBe('true');
  });

  it('is true when the collab scope is readonly, even on desktop', () => {
    mockMobileMediaQuery(false);
    render(<Probe {...CONNECTED_EDITABLE} collabScope="readonly" />);
    expect(screen.getByTestId('result').textContent).toBe('true');
  });
});
