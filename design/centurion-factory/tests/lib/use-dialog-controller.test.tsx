import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useDialogController } from '../../src/lib/use-dialog-controller';

function Harness(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { dialogRef } = useDialogController({ open, onClose: () => setOpen(false) });

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <dialog ref={dialogRef} tabIndex={-1} aria-label="Diálogo de prueba">
        <button type="button">Dentro</button>
      </dialog>
    </div>
  );
}

describe('useDialogController', () => {
  it('opens the dialog element when open becomes true', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('dialog', { name: 'Diálogo de prueba' })).toBeTruthy();
  });

  it('moves focus into the dialog on open', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Diálogo de prueba' }));
  });

  it('returns focus to the trigger when the dialog closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Diálogo de prueba' });

    act(() => {
      dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    });

    expect(document.activeElement).toBe(trigger);
  });

  it('calls onClose when the dialog fires a cancel event', () => {
    const onClose = vi.fn();
    function Probe(): React.ReactElement {
      const { dialogRef } = useDialogController({ open: true, onClose });
      return <dialog ref={dialogRef} aria-label="Diálogo" />;
    }
    render(<Probe />);
    const dialog = screen.getByRole('dialog', { name: 'Diálogo' });

    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
