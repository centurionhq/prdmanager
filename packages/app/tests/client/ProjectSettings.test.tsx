import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { OrgShell } from '../../src/routes/OrgShell.js';
import { ProjectSettings } from '../../src/routes/ProjectSettings.js';

const PROJECT = { id: 'proj1', slug: 'web', name: 'Web', graphProjectId: 'prj_abc', settings: {} as never, archivedAt: null };

const PROJECT_MEMBERS = [{ userId: 'u2', email: 'dev@example.test', name: 'Dev', role: 'developer' as const }];
const ORG_MEMBERS = [
  { userId: 'u1', email: 'me@example.test', name: 'Me', role: 'member' as const },
  { userId: 'u2', email: 'dev@example.test', name: 'Dev', role: 'member' as const },
  { userId: 'u3', email: 'new@example.test', name: 'New', role: 'member' as const },
];

function renderPage(orgRole: 'owner' | 'admin' | 'member', sessionUserId: string) {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: orgRole }]);
  vi.spyOn(client, 'listProjects').mockResolvedValue([]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: sessionUserId, email: 'me@example.test', name: 'Me' } });
  vi.spyOn(client, 'getProject').mockResolvedValue(PROJECT);
  vi.spyOn(client, 'listProjectMembers').mockResolvedValue(PROJECT_MEMBERS);
  vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue(ORG_MEMBERS);

  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug', element: <OrgShell />, children: [{ path: 'p/:projectSlug/settings', element: <ProjectSettings /> }] }],
    { initialEntries: ['/o/acme/p/web/settings'] },
  );
  render(<RouterProvider router={router} />);
}

describe('ProjectSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the project header and members read-only for a plain org member with no project role', async () => {
    renderPage('member', 'u1');

    expect(await screen.findByRole('heading', { name: 'Web' })).toBeTruthy();
    expect(screen.getByText('dev@example.test')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Rol de/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Agregar miembro' })).toBeNull();
  });

  it('an org admin (no project_members row) can manage members via inherited admin', async () => {
    const addMember = vi.spyOn(client, 'addProjectMember').mockResolvedValue(undefined);
    renderPage('admin', 'u4');

    await screen.findByRole('heading', { name: 'Web' });
    expect(screen.getByRole('combobox', { name: 'Rol de dev@example.test' })).toBeTruthy();

    await screen.findByRole('heading', { name: 'Agregar miembro' });
    await userEvent.selectOptions(screen.getByLabelText('Miembro de la organización'), 'u3');
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'editor');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => expect(addMember).toHaveBeenCalledWith('acme', 'web', { userId: 'u3', role: 'editor' }));
  });

  it('a plain member with their own project admin row can also manage members', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: 'member' }]);
    vi.spyOn(client, 'listProjects').mockResolvedValue([]);
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Me' } });
    vi.spyOn(client, 'getProject').mockResolvedValue(PROJECT);
    vi.spyOn(client, 'listProjectMembers').mockResolvedValue([...PROJECT_MEMBERS, { userId: 'u1', email: 'me@example.test', name: 'Me', role: 'admin' }]);
    vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue(ORG_MEMBERS);

    const router = createMemoryRouter(
      [{ path: '/o/:orgSlug', element: <OrgShell />, children: [{ path: 'p/:projectSlug/settings', element: <ProjectSettings /> }] }],
      { initialEntries: ['/o/acme/p/web/settings'] },
    );
    render(<RouterProvider router={router} />);

    await screen.findByRole('heading', { name: 'Web' });
    expect(screen.getByRole('combobox', { name: 'Rol de dev@example.test' })).toBeTruthy();
  });
});
