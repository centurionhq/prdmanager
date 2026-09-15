import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/components/Modal/Modal';

function renderModal(onClose: () => void, open = true) {
  return render(
    <div>
      <button type="button">Afuera</button>
      <Modal open={open} title="Reconocer drift" description="Descripción del modal" onClose={onClose} footer={<button type="button">Confirmar</button>}>
        <p>Contenido del modal</p>
      </Modal>
    </div>,
  );
}

describe('Modal', () => {
  it('is not visible in the accessibility tree when closed', () => {
    renderModal(vi.fn(), false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders with the title as its accessible name', () => {
    renderModal(vi.fn());
    expect(screen.getByRole('dialog', { name: 'Reconocer drift' })).toBeTruthy();
  });

  it('renders children and the footer', () => {
    renderModal(vi.fn());
    expect(screen.getByText('Contenido del modal')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy();
  });

  it('moves focus into the dialog on open', () => {
    renderModal(vi.fn());
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('calls onClose when Esc fires the native cancel event', () => {
    const onClose = vi.fn();
    renderModal(onClose);
    const dialog = screen.getByRole('dialog');
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the scrim (the dialog element itself) is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when the panel content is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);
    await user.click(screen.getByText('Contenido del modal'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the previously focused element on close', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Afuera
          </button>
          <Modal open={open} title="Título" onClose={() => setOpen(false)}>
            <p>Contenido</p>
          </Modal>
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Afuera' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog');
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });

    expect(document.activeElement).toBe(trigger);
  });
});
