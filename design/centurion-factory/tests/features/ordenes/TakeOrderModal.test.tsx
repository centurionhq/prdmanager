import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TakeOrderModal } from '../../../src/features/ordenes/TakeOrderModal';

function renderModal(handle: string | null, onConfirm = vi.fn(), onClose = vi.fn()) {
  render(<TakeOrderModal open orderId="WO-311" handle={handle} onClose={onClose} onConfirm={onConfirm} />);
  const dialog = screen.getByRole('dialog', { name: 'Tomar orden' });
  return { dialog, onConfirm, onClose };
}

describe('TakeOrderModal', () => {
  it('starts on «Yo» with the session handle, and confirming sends that dev actor', async () => {
    const user = userEvent.setup();
    const { dialog, onConfirm } = renderModal('ana');
    expect((within(dialog).getByRole('radio', { name: 'Yo (dev:ana)' }) as HTMLInputElement).checked).toBe(true);
    // The agent field only exists once its option is picked.
    expect(within(dialog).queryByRole('textbox', { name: 'Nombre del agente' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));
    expect(onConfirm).toHaveBeenCalledWith('dev:ana');
  });

  it('validates the agent name on confirm instead of disabling the button', async () => {
    const user = userEvent.setup();
    const { dialog, onConfirm } = renderModal('ana');
    await user.click(within(dialog).getByRole('radio', { name: /Un agente/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Escribí el nombre del agente');
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre del agente' }), 'no vale');
    await user.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Escribí el nombre del agente');
    expect(onConfirm).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByRole('textbox', { name: 'Nombre del agente' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre del agente' }), ' claude.2 ');
    await user.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));
    expect(onConfirm).toHaveBeenCalledWith('agent:claude.2');
  });

  it('without a session handle «Yo» is disabled, the reason is visible and the agent form is the one left', async () => {
    const user = userEvent.setup();
    const { dialog, onConfirm } = renderModal(null);
    const self = within(dialog).getByRole('radio', { name: 'Yo (sin handle)' }) as HTMLInputElement;
    expect(self.disabled).toBe(true);
    expect(self.checked).toBe(false);
    const note = within(dialog).getByText('Definí tu handle en Ajustes › Perfil.');
    expect(within(dialog).getByRole('radiogroup', { name: 'Asignar a' }).getAttribute('aria-describedby')).toBe(note.id);
    // The agent field is already there: nothing left to pick.
    const name = within(dialog).getByRole('textbox', { name: 'Nombre del agente' });
    await user.type(name, 'claude');
    await user.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));
    expect(onConfirm).toHaveBeenCalledWith('agent:claude');
    // The disabled option can never be chosen, even by clicking it.
    await user.click(within(dialog).getByText('Yo (sin handle)'));
    expect((within(dialog).getByRole('radio', { name: 'Yo (sin handle)' }) as HTMLInputElement).checked).toBe(false);
  });

  it('drops what was typed when the modal is closed, so reopening it starts clean', async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = renderModal('ana');
    await user.click(within(dialog).getByRole('radio', { name: /Un agente/ }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre del agente' }), 'claude');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
