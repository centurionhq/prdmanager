import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { OrgMembersSettings } from '../../src/routes/OrgMembersSettings.js';
import { OrgShell } from '../../src/routes/OrgShell.js';

const MEMBERS = [
  { userId: 'u1', email: 'owner@example.test', name: 'Owner', role: 'owner' as const },
  { userId: 'u2', email: 'member@example.test', name: 'Member', role: 'member' as const },
];

const INVITATIONS = [{ id: 'inv1', email: 'pending@example.test', role: 'member' as const, status: 'pending', expiresAt: '2026-12-31T00:00:00.000Z' }];

function renderPage(
  role: 'owner' | 'admin' | 'member',
  options: {
    projects?: import('@prdm/contracts').ProjectSummary[];
    projectMembersBySlug?: Record<string, import('@prdm/contracts').ProjectMemberDto[]>;
  } = {},
) {
  const { projects = [], projectMembersBySlug = {} } = options;
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role }]);
  vi.spyOn(client, 'listProjects').mockResolvedValue(projects);
  vi.spyOn(client, 'listProjectMembers').mockImplementation((_orgSlug, projectSlug) =>
    Promise.resolve(projectMembersBySlug[projectSlug] ?? []),
  );
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'caller', email: 'caller@example.test', name: 'Caller' } });
  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug', element: <OrgShell />, children: [{ path: 'settings/members', element: <OrgMembersSettings /> }] }],
    { initialEntries: ['/o/acme/settings/members'] },
  );
  render(<RouterProvider router={router} />);
}

describe('OrgMembersSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the member table read-only for a plain member, with no invitations section', async () => {
    vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue(MEMBERS);
    renderPage('member');

    expect(await screen.findByText('owner@example.test')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Rol de/ })).toBeNull();
    expect(screen.queryByText('Invitaciones pendientes')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invitar' })).toBeNull();
  });

  it('lets an admin change a role, remove a member, and revoke an invitation', async () => {
    vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue(MEMBERS);
    vi.spyOn(client, 'listOrganizationInvitations').mockResolvedValue(INVITATIONS);
    const updateRole = vi.spyOn(client, 'updateOrganizationMemberRole').mockResolvedValue(undefined);
    const remove = vi.spyOn(client, 'removeOrganizationMember').mockResolvedValue(undefined);
    const revoke = vi.spyOn(client, 'revokeOrganizationInvitation').mockResolvedValue(undefined);
    renderPage('admin');

    await screen.findByText('pending@example.test');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Rol de member@example.test' }), 'admin');
    await waitFor(() => expect(updateRole).toHaveBeenCalledWith('acme', 'u2', 'admin'));

    const rows = screen.getAllByRole('button', { name: 'Quitar' });
    await userEvent.click(rows[rows.length - 1]!);
    await waitFor(() => expect(remove).toHaveBeenCalledWith('acme', 'u2'));

    await userEvent.click(screen.getByRole('button', { name: 'Revocar' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('acme', 'inv1'));
  });

  it('surfaces a server error (e.g. last-owner rule) without crashing the page', async () => {
    vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue(MEMBERS);
    vi.spyOn(client, 'listOrganizationInvitations').mockResolvedValue([]);
    vi.spyOn(client, 'removeOrganizationMember').mockRejectedValue(new client.ApiClientError(403, 'forbidden', 'cannot remove the last owner'));
    renderPage('admin');

    await screen.findByText('owner@example.test');
    const [removeOwnerButton] = screen.getAllByRole('button', { name: 'Quitar' });
    await userEvent.click(removeOwnerButton!);

    expect(await screen.findByText('cannot remove the last owner')).toBeTruthy();
  });

  it('an admin (not owner) cannot invite a new owner', async () => {
    vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue(MEMBERS);
    vi.spyOn(client, 'listOrganizationInvitations').mockResolvedValue([]);
    renderPage('admin');

    await screen.findByRole('heading', { name: 'Invitar miembro' });
    const roleSelect = screen.getByLabelText('Rol en la organización') as HTMLSelectElement;
    const optionValues = Array.from(roleSelect.options).map((o) => o.value);
    expect(optionValues).not.toContain('owner');
  });

  it('blocks removing yourself, showing every other admin its own Quitar button', async () => {
    vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue([
      { userId: 'caller', email: 'caller@example.test', name: 'Caller', role: 'admin' as const },
      ...MEMBERS,
    ]);
    vi.spyOn(client, 'listOrganizationInvitations').mockResolvedValue([]);
    renderPage('admin');

    await screen.findByText('caller@example.test');
    expect(screen.getByText('No podés quitarte')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(2);
  });

  it('shows how many projects each member belongs to', async () => {
    vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue(MEMBERS);
    vi.spyOn(client, 'listOrganizationInvitations').mockResolvedValue([]);
    renderPage('admin', {
      projects: [
        { id: 'p1', slug: 'web', name: 'Web', graphProjectId: 'prj_1', settings: {} as never, archivedAt: null },
        { id: 'p2', slug: 'api', name: 'Api', graphProjectId: 'prj_2', settings: {} as never, archivedAt: null },
      ],
      projectMembersBySlug: {
        web: [{ userId: 'u1', email: 'owner@example.test', name: 'Owner', role: 'admin' as const }],
        api: [
          { userId: 'u1', email: 'owner@example.test', name: 'Owner', role: 'admin' as const },
          { userId: 'u2', email: 'member@example.test', name: 'Member', role: 'viewer' as const },
        ],
      },
    });

    const ownerRow = (await screen.findByText('owner@example.test')).closest('tr')!;
    const memberRow = screen.getByText('member@example.test').closest('tr')!;
    expect(ownerRow.textContent).toContain('2');
    expect(memberRow.textContent).toContain('1');
  });

  it('resends a pending invitation and shows a confirmation', async () => {
    vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue(MEMBERS);
    vi.spyOn(client, 'listOrganizationInvitations').mockResolvedValue(INVITATIONS);
    const resend = vi.spyOn(client, 'resendInvitation').mockResolvedValue(undefined);
    renderPage('admin');

    await userEvent.click(await screen.findByRole('button', { name: 'Reenviar' }));

    await waitFor(() => expect(resend).toHaveBeenCalledWith('acme', 'inv1'));
    expect(await screen.findByText('Invitación reenviada')).toBeTruthy();
  });
});
