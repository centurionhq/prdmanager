import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { OrgShell } from '../../src/routes/OrgShell.js';

const ORGS = [
  { id: 'org1', slug: 'acme', name: 'Acme', role: 'owner' as const },
  { id: 'org2', slug: 'other', name: 'Other Co', role: 'member' as const },
];

function renderShell(initialPath = '/o/acme') {
  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug',
        element: <OrgShell />,
        children: [{ index: true, element: <p>projects dashboard</p> }],
      },
      { path: '/login', element: <p>login screen</p> },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
}

describe('OrgShell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the org switcher and nested route once organizations load', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue(ORGS);
    renderShell();

    expect(await screen.findByText('projects dashboard')).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Organización' }) as HTMLSelectElement;
    expect(select.value).toBe('acme');
    expect(screen.getByRole('option', { name: 'Other Co' })).toBeTruthy();
  });

  it('keeps the header and switcher (without the missing org) around the not-found notice', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue(ORGS);
    renderShell('/o/nope');

    expect(await screen.findByText('Organización no encontrada')).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Organización' });
    expect(within(select).getByRole('option', { name: 'Acme' })).toBeTruthy();
    expect(within(select).getByRole('option', { name: 'Other Co' })).toBeTruthy();
    expect(within(select).queryByRole('option', { name: /nope/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tokens' })).toBeTruthy();
    for (const name of ['Proyectos', 'Miembros', 'Auditoría']) {
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
  });

  it('switching organizations calls setActiveOrganization and navigates', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue(ORGS);
    const setActive = vi.spyOn(client, 'setActiveOrganization').mockResolvedValue(undefined);
    renderShell();

    await screen.findByText('projects dashboard');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organización' }), 'other');

    await waitFor(() => expect(setActive).toHaveBeenCalledWith('org2'));
  });

  it('with a single organization it shows the name as text and renders no form control', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([ORGS[0]!]);
    renderShell();

    await screen.findByText('projects dashboard');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Acme')).toBeTruthy();
  });

  it('with two or more organizations the switcher keeps both options and is identified', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue(ORGS);
    renderShell();

    await screen.findByText('projects dashboard');
    const select = screen.getByRole('combobox', { name: 'Organización' }) as HTMLSelectElement;
    expect(select.id).toBe('org-switcher');
    expect(select.getAttribute('name')).toBe('organization');
    expect(screen.getByRole('option', { name: 'Acme' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Other Co' })).toBeTruthy();
  });

  it('with a single organization the not-found branch renders no form control', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([ORGS[0]!]);
    renderShell('/o/nope');

    expect(await screen.findByText('Organización no encontrada')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('sign out calls the API and navigates to /login', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue(ORGS);
    vi.spyOn(client, 'signOut').mockResolvedValue(undefined);
    renderShell();

    await screen.findByText('projects dashboard');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByText('login screen')).toBeTruthy();
  });
});
