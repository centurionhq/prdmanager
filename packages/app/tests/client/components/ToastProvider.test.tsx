import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../../../src/components/ToastProvider/ToastProvider';

/** The real per-item failure message a batch can produce, long enough to blow past the toast plate. */
const LONG_MESSAGE =
  '2 de 3 archivadas; no se pudieron archivar: WO-301 (cannot archive WO-301: status is done, expected pending, in_progress or out_of_sync)';

function Harness(): React.ReactElement {
  const { show } = useToast();
  return (
    <div>
      <button type="button" onClick={() => show('Guardado')}>
        Mostrar neutral
      </button>
      <button type="button" onClick={() => show('Listo', { tone: 'success' })}>
        Mostrar éxito
      </button>
      <button type="button" onClick={() => show(LONG_MESSAGE)}>
        Mostrar lote con fallas
      </button>
    </div>
  );
}

describe('ToastProvider', () => {
  it('renders a polite live region even with no toast shown', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('shows the message passed to show()', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Mostrar neutral' }));
    expect(screen.getByText('Guardado')).toBeTruthy();
  });

  it('renders a check icon for the success tone', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Mostrar éxito' }));
    expect(screen.getByText('Listo')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('clamps a long message to one 480px line without losing the text', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Mostrar lote con fallas' }));

    // Truncation is visual only: the whole message stays in the DOM, so assistive tech reads it in full.
    expect(screen.getByText(LONG_MESSAGE).textContent).toBe(LONG_MESSAGE);

    // jsdom has no layout and applies no stylesheet, so the clamp is asserted on the rules that do it
    // (same approach as Drawer.test.tsx's 44px hit-target check).
    const css = readFileSync(resolve(import.meta.dirname, '../../../src/components/ToastProvider/ToastProvider.module.css'), 'utf8');
    expect(css).toMatch(/\.toast\s*\{[^}]*max-width:\s*480px/);
    expect(css).toMatch(/\.toast\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.toast\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.toast\s*\{[^}]*text-overflow:\s*ellipsis/);
    // A flex container turns a raw string into an anonymous flex item, which cannot ellipsize: the message
    // span owns the overflow, so it needs `min-width: 0` to be allowed to shrink below its content.
    expect(css).toMatch(/\.message\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.message\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('throws when useToast is used outside a ToastProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Harness />)).toThrow();
    consoleError.mockRestore();
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('auto-dismisses after 4000ms', () => {
      render(
        <ToastProvider>
          <Harness />
        </ToastProvider>,
      );
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar neutral' }));
      });
      expect(screen.getByText('Guardado')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(screen.queryByText('Guardado')).toBeNull();
    });

    it('replaces an older toast with a newer one', () => {
      render(
        <ToastProvider>
          <Harness />
        </ToastProvider>,
      );
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar neutral' }));
      });
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar éxito' }));
      });

      expect(screen.queryByText('Guardado')).toBeNull();
      expect(screen.getByText('Listo')).toBeTruthy();
    });
  });
});
