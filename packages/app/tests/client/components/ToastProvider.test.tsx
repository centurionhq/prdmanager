import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../../../src/components/ToastProvider/ToastProvider';

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
