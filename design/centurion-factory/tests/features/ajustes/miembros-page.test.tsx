import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

function membersTable(): HTMLElement {
  return screen.getByRole('table', { name: 'Miembros de prdmanager' });
}

function memberRow(name: string): HTMLElement {
  const cell = within(membersTable()).getByText(name).closest('tr');
  if (!cell) throw new Error(`Row for ${name} not found`);
  return cell;
}

describe('MiembrosPage', () => {
  it('renders the section title, description and invite action', async () => {
    renderAt('/ajustes/miembros');
    expect(await screen.findByRole('heading', { level: 2, name: 'Miembros de prdmanager' })).toBeTruthy();
    expect(screen.getByText('Quién puede ver, editar, publicar y reconocer drift en este proyecto.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invitar persona' })).toBeTruthy();
  });

  it("marks Ana as Vos and disables her role, hiding her Quitar action behind a hint (WO-317)", async () => {
    renderAt('/ajustes/miembros');
    await screen.findByRole('heading', { level: 2 });
    const row = memberRow('Ana Ríos');
    expect(within(row).getByText('Vos')).toBeTruthy();
    expect(within(row).getByRole('combobox', { name: 'Rol de Ana Ríos' }).hasAttribute('disabled')).toBe(true);
    expect(within(row).queryByRole('button', { name: 'Quitar' })).toBeNull();
    expect(within(row).getByText('No podés quitarte')).toBeTruthy();
  });

  it("changes Julia's role and announces it with a toast", async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/miembros');
    await screen.findByRole('heading', { level: 2 });
    const row = memberRow('Julia Paz');
    const select = within(row).getByRole('combobox', { name: 'Rol de Julia Paz' });

    await user.selectOptions(select, 'developer');

    expect(await screen.findByText('Rol de Julia Paz: Developer')).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe('developer');
  });

  it('confirms before removing a member and then shows a toast', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/miembros');
    await screen.findByRole('heading', { level: 2 });
    const row = memberRow('Lucas Vera');

    await user.click(within(row).getByRole('button', { name: 'Quitar' }));
    expect(
      screen.getByText('¿Quitar a Lucas Vera de prdmanager? Pierde el acceso al instante.'),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Lucas Vera ya no tiene acceso')).toBeTruthy();
    expect(screen.queryByText('Lucas Vera')).toBeNull();
  });

  it('labels the Rol and Acceso cells for the stacked mobile layout (WO-316)', async () => {
    renderAt('/ajustes/miembros');
    await screen.findByRole('heading', { level: 2 });
    const row = memberRow('Julia Paz');
    expect(within(row).getByRole('combobox', { name: 'Rol de Julia Paz' }).closest('td')?.getAttribute('data-label')).toBe('Rol');
  });

  it('shows the pending invitation row with resend and revoke actions', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/miembros');
    const invitationRow = (await screen.findByText('Invitación pendiente')).closest('tr');
    if (!invitationRow) throw new Error('Invitation row not found');

    expect(within(invitationRow).getByText(/Invitado por Ana Ríos, vence el/)).toBeTruthy();

    await user.click(within(invitationRow).getByRole('button', { name: 'Reenviar' }));
    expect(await screen.findByText('Invitación reenviada')).toBeTruthy();

    await user.click(within(invitationRow).getByRole('button', { name: 'Revocar' }));
    expect(await screen.findByText('Invitación revocada')).toBeTruthy();
    expect(screen.queryByText('Invitación pendiente')).toBeNull();
  });

  it('associates the invite email error with the field via aria-invalid/aria-describedby (WO-317)', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/miembros');
    await screen.findByRole('heading', { level: 2 });
    await user.click(screen.getByRole('button', { name: 'Invitar persona' }));

    const dialog = screen.getByRole('dialog', { name: 'Invitar persona' });
    const emailField = within(dialog).getByRole('textbox', { name: 'Email' });
    expect(emailField.getAttribute('aria-invalid')).toBeNull();

    await user.type(emailField, 'not-an-email');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar invitación' }));

    const error = within(dialog).getByText('Escribí un email válido.');
    expect(emailField.getAttribute('aria-invalid')).toBe('true');
    expect(emailField.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('gives the role radiogroup a single tab stop with roving arrow-key navigation (WO-317)', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/miembros');
    await screen.findByRole('heading', { level: 2 });
    await user.click(screen.getByRole('button', { name: 'Invitar persona' }));

    const dialog = screen.getByRole('dialog', { name: 'Invitar persona' });
    const group = within(dialog).getByRole('radiogroup', { name: 'Rol en prdmanager' });
    const groupLabel = within(dialog).getByText('Rol en prdmanager');
    expect(group.getAttribute('aria-labelledby')).toBe(groupLabel.id);

    const radios = within(dialog).getAllByRole('radio');
    expect(radios.filter((radio) => radio.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(radios.filter((radio) => radio.getAttribute('tabindex') === '-1')).toHaveLength(radios.length - 1);

    const developer = within(dialog).getByRole('radio', { name: 'Developer' });
    developer.focus();
    await user.keyboard('{ArrowRight}');

    expect(within(dialog).getByRole('radio', { name: 'Commenter' })).toHaveProperty('tabIndex', 0);
    expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: 'Commenter' }));
  });

  it('validates the invite email, flags a non-centurionhq domain and sends the invite', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/miembros');
    await screen.findByRole('heading', { level: 2 });
    await user.click(screen.getByRole('button', { name: 'Invitar persona' }));

    const dialog = screen.getByRole('dialog', { name: 'Invitar persona' });
    const emailField = within(dialog).getByRole('textbox', { name: 'Email' });

    await user.type(emailField, 'not-an-email');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar invitación' }));
    expect(within(dialog).getByText('Escribí un email válido.')).toBeTruthy();

    await user.clear(emailField);
    await user.type(emailField, 'tomas@gmail.com');
    expect(within(dialog).getByText('Es de otro dominio: va a entrar con contraseña.')).toBeTruthy();

    expect(within(dialog).getByText('Puede comentar y tomar órdenes de trabajo.')).toBeTruthy();
    await user.click(within(dialog).getByRole('radio', { name: 'Admin' }));
    expect(within(dialog).getByText('Puede publicar, reconocer drift, cerrar features y gestionar miembros.')).toBeTruthy();

    await user.clear(emailField);
    await user.type(emailField, 'nueva.persona@centurionhq.com');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar invitación' }));

    expect(await screen.findByText('Invitación enviada')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Invitar persona' })).toBeNull();
    expect(screen.getByText('nueva.persona@centurionhq.com')).toBeTruthy();
  });

  it('builds the role permission matrix with accessible Sí/No cells', async () => {
    renderAt('/ajustes/miembros');
    const table = await screen.findByRole('table', { name: 'Qué puede hacer cada rol' });

    const publishRow = within(table).getByRole('row', { name: /Publicar/ });
    const publishCells = within(publishRow).getAllByRole('cell');
    expect(within(publishCells[0]!).getByText('Sí', { selector: '.visually-hidden' })).toBeTruthy();
    expect(within(publishCells[4]!).getByText('No', { selector: '.visually-hidden' })).toBeTruthy();

    const viewRow = within(table).getByRole('row', { name: /^Ver/ });
    for (const cell of within(viewRow).getAllByRole('cell')) {
      expect(within(cell).getByText('Sí', { selector: '.visually-hidden' })).toBeTruthy();
    }
  });
});
