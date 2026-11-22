import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgRole, ProjectRole } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { AjustesMiembros } from '../../src/routes/AjustesMiembros.js';
import { makeProjectShellContext } from './fixtures.js';

const PROJECT_MEMBERS = [
  { userId: 'u1', email: 'me@example.test', name: 'Me', role: 'admin' as const },
  { userId: 'u2', email: 'dev@example.test', name: 'Dev', role: 'developer' as const },
];
const ORG_MEMBERS = [
  { userId: 'u1', email: 'me@example.test', name: 'Me', role: 'member' as const },
  { userId: 'u2', email: 'dev@example.test', name: 'Dev', role: 'member' as const },
  { userId: 'u3', email: 'new@example.test', name: 'New', role: 'member' as const },
];

function renderAjustesMiembros(orgRole: OrgRole, myRole?: ProjectRole): void {
  vi.spyOn(client, 'listProjectMembers').mockResolvedValue(PROJECT_MEMBERS);
  vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue(ORG_MEMBERS);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Me' } });

  const router = createMemoryRouter(
    [
      {
        path: '/ctx',
        element: <Outlet context={makeProjectShellContext(orgRole, myRole)} />,
        children: [{ index: true, element: <AjustesMiembros /> }],
      },
    ],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('AjustesMiembros', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows members read-only for a plain project viewer', async () => {
    renderAjustesMiembros('member', 'viewer');

    expect(await screen.findByText('dev@example.test')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Rol de/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Agregar miembro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar miembro' })).toBeNull();
  });

  it('an org admin (no project_members row) can manage members via inherited admin', async () => {
    const addMember = vi.spyOn(client, 'addProjectMember').mockResolvedValue(undefined);
    renderAjustesMiembros('admin');

    expect(await screen.findByRole('combobox', { name: 'Rol de dev@example.test' })).toBeTruthy();

    // The form lives in a dialog behind the section's primary action (canvas `AjustesMiembros.dc.html`).
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar miembro' }));
    expect(await screen.findByRole('heading', { name: 'Agregar miembro' })).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Miembro de la organización'), 'u3');
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'editor');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => expect(addMember).toHaveBeenCalledWith('acme', 'web', { userId: 'u3', role: 'editor' }));
  });

  it('a project admin can also manage members', async () => {
    renderAjustesMiembros('member', 'admin');

    expect(await screen.findByRole('combobox', { name: 'Rol de dev@example.test' })).toBeTruthy();
  });

  it('cannot remove yourself, but can remove someone else', async () => {
    renderAjustesMiembros('admin');

    await screen.findByRole('combobox', { name: 'Rol de dev@example.test' });
    expect(screen.getByText('No podés quitarte')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Quitar/ })).toHaveLength(1);
  });

  it('marks the row that is you, and lists people by name and email', async () => {
    renderAjustesMiembros('admin');

    expect(await screen.findByText('Vos')).toBeTruthy();
    expect(screen.getByText('dev@example.test')).toBeTruthy();
  });

  it('shows the role capability matrix derived from the permission matrix', async () => {
    renderAjustesMiembros('admin');

    await screen.findByRole('heading', { name: 'Qué puede hacer cada rol' });
    expect(screen.getByRole('columnheader', { name: 'Administrador' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Lector' })).toBeTruthy();
    expect(screen.getByRole('row', { name: /Gestionar miembros/ })).toBeTruthy();
  });
});
