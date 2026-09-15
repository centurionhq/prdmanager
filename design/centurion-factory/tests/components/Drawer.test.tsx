import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from '../../src/components/Drawer/Drawer';

function renderDrawer(onClose: () => void, open = true) {
  return render(
    <Drawer open={open} title="Resumen del importador" onClose={onClose} footer={<button type="button">Retomar orden</button>}>
      <p>Contenido del drawer</p>
    </Drawer>,
  );
}

describe('Drawer', () => {
  it('is not visible in the accessibility tree when closed', () => {
    renderDrawer(vi.fn(), false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders with the title as its accessible name', () => {
    renderDrawer(vi.fn());
    expect(screen.getByRole('dialog', { name: 'Resumen del importador' })).toBeTruthy();
  });

  it('renders children and the footer', () => {
    renderDrawer(vi.fn());
    expect(screen.getByText('Contenido del drawer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retomar orden' })).toBeTruthy();
  });

  it('moves focus into the drawer on open', () => {
    renderDrawer(vi.fn());
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('calls onClose on the native cancel event (Esc)', () => {
    const onClose = vi.fn();
    renderDrawer(onClose);
    const dialog = screen.getByRole('dialog');
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDrawer(onClose);
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when a drag starting inside the panel is released over the scrim', () => {
    const onClose = vi.fn();
    renderDrawer(onClose);
    const dialog = screen.getByRole('dialog');
    const panelContent = screen.getByText('Contenido del drawer');

    act(() => {
      panelContent.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose only when both mousedown and click land on the scrim itself', () => {
    const onClose = vi.fn();
    renderDrawer(onClose);
    const dialog = screen.getByRole('dialog');

    act(() => {
      dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the trigger on close', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir
          </button>
          <Drawer open={open} title="Resumen" onClose={() => setOpen(false)}>
            <p>Contenido</p>
          </Drawer>
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog');
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });

    expect(document.activeElement).toBe(trigger);
  });

  it('grows the close button to a 44px hit target below the mobile breakpoint', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../src/components/Drawer/Drawer.module.css'), 'utf8');
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.close\s*\{[^}]*width:\s*var\(--hit-target\)/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.close\s*\{[^}]*height:\s*var\(--hit-target\)/s);
  });
});
