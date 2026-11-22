/**
 * `ConfirmDialog` (SDD-062, WO-717, `ConfirmDialog.dc.html`): the design-system confirmation dialog for
 * the destructive actions of Ajustes. The mutation only ever comes from the confirm button; Cancelar gets
 * the initial focus; Esc, the X and the scrim all cancel — except while a mutation is in flight, when the
 * dialog stays put until the server answers; an error keeps it open with the message and turns the action
 * into "Reintentar".
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../../src/components';

const CI_TOKEN = {
  title: 'Revocar el token "github-actions-real-ci"?',
  description: 'Deja de funcionar de inmediato. Si lo usa tu pipeline, vas a tener que generar uno nuevo y actualizar el secreto. No se puede deshacer.',
  resource: { name: 'github-actions-real-ci', meta: 'Creado el 16/09/2026 · usado hace 4 min' },
  confirmLabel: 'Revocar token',
};

function renderConfirm(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const props = { open: true, ...CI_TOKEN, onConfirm, onCancel, ...overrides };
  const view = render(<ConfirmDialog {...props} />);
  return { ...view, onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('is not visible in the accessibility tree when closed', () => {
    renderConfirm({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the title as its accessible name and renders the description, the resource and the confirm label', () => {
    renderConfirm();
    expect(screen.getByRole('dialog', { name: CI_TOKEN.title })).toBeTruthy();
    expect(screen.getByText(CI_TOKEN.description)).toBeTruthy();
    expect(screen.getByText('github-actions-real-ci')).toBeTruthy();
    expect(screen.getByText('Creado el 16/09/2026 · usado hace 4 min')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revocar token' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('works without a resource plate', () => {
    renderConfirm({ resource: undefined });
    expect(screen.queryByText('Creado el 16/09/2026 · usado hace 4 min')).toBeNull();
    expect(screen.getByRole('button', { name: 'Revocar token' })).toBeTruthy();
  });

  it('puts the initial focus on Cancelar, not on the destructive action', () => {
    renderConfirm();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
  });

  it('calls onConfirm exactly once when the destructive action is confirmed', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderConfirm();
    await user.click(screen.getByRole('button', { name: 'Revocar token' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels without confirming when Cancelar is clicked', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderConfirm();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on Esc', () => {
    const { onCancel, onConfirm } = renderConfirm();
    act(() => {
      screen.getByRole('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on the X', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderConfirm();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on a scrim click (the dialog element itself)', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderConfirm();
    await user.click(screen.getByRole('dialog'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('while pending: disables both buttons, shows busyLabel and does not confirm again', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderConfirm({ pending: true, busyLabel: 'Revocando' });
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    const action = screen.getByRole('button', { name: 'Revocando' });
    expect(cancel).toHaveProperty('disabled', true);
    expect(action).toHaveProperty('disabled', true);
    await user.click(action);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('while pending: Esc, the X and the scrim do not close the dialog', () => {
    const { onCancel } = renderConfirm({ pending: true, busyLabel: 'Revocando' });
    const dialog = screen.getByRole('dialog');
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    act(() => {
      screen.getByRole('button', { name: 'Cerrar' }).click();
      dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the error with role="alert", turning the action into Reintentar', () => {
    const { onCancel } = renderConfirm({ error: 'No pudimos revocar el token. El token sigue activo.' });
    expect(screen.getByRole('alert').textContent).toContain('No pudimos revocar el token. El token sigue activo.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('returns the focus to the control that opened it when the dialog closes', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Revocar
          </button>
          <ConfirmDialog {...CI_TOKEN} open={open} onConfirm={vi.fn()} onCancel={() => setOpen(false)} />
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Revocar' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(document.activeElement).toBe(trigger);
  });

  it('scrolls its own content instead of the page and stacks full-width buttons below the mobile breakpoint', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../../src/components/ConfirmDialog/ConfirmDialog.module.css'), 'utf8');
    expect(css).toMatch(/\.scroll\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.scroll\s*\{[^}]*max-height:/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[^}]*\.footer\s*\{[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*\.button\s*\{[^}]*width:\s*100%/s);
  });
});
