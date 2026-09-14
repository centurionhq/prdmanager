import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { OrgShell } from '../../src/routes/OrgShell.js';
import { ProjectSettings } from '../../src/routes/ProjectSettings.js';

const PROJECT = { id: 'proj1', slug: 'web', name: 'Web', graphProjectId: 'prj_abc', settings: {} as never, archivedAt: null };
const CI_TOKEN: import('@prdm/contracts').TokenSummaryDto = {
  id: 'tok1',
  kind: 'project_ci',
  name: 'ci-pipeline',
  prefix: 'prdm_ci_abcd',
  scopes: ['reports:write'],
  expiresAt: '2026-12-31T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderProjectSettings(orgRole: 'owner' | 'admin' | 'member', projectRole?: 'admin' | 'editor' | 'developer' | 'commenter' | 'viewer') {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: orgRole }]);
  vi.spyOn(client, 'listProjects').mockResolvedValue([]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Me' } });
  vi.spyOn(client, 'getProject').mockResolvedValue(PROJECT);
  const projectMembers = projectRole ? [{ userId: 'u1', email: 'me@example.test', name: 'Me', role: projectRole }] : [];
  vi.spyOn(client, 'listProjectMembers').mockResolvedValue(projectMembers);
  vi.spyOn(client, 'listOrganizationMembers').mockResolvedValue([{ userId: 'u1', email: 'me@example.test', name: 'Me', role: orgRole }]);

  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug', element: <OrgShell />, children: [{ path: 'p/:projectSlug/settings', element: <ProjectSettings /> }] }],
    { initialEntries: ['/o/acme/p/web/settings'] },
  );
  render(<RouterProvider router={router} />);
}

describe('CiTokensSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is hidden for a viewer with no manage_ci_tokens permission', async () => {
    renderProjectSettings('member', 'viewer');

    await screen.findByRole('heading', { name: 'Web' });
    expect(screen.queryByRole('heading', { name: 'Tokens de CI' })).toBeNull();
  });

  it('is shown for a project admin and lets them create + revoke a CI token', async () => {
    vi.spyOn(client, 'listCiTokens').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createCiToken').mockResolvedValue({ token: CI_TOKEN, secret: 'prdm_ci_abcd.SECRET' });
    renderProjectSettings('admin');

    expect(await screen.findByRole('heading', { name: 'Tokens de CI' })).toBeTruthy();
    await screen.findByText(/Todavía no hay tokens/);

    await userEvent.type(screen.getByLabelText('Nombre'), 'ci-pipeline');
    await userEvent.click(screen.getByLabelText('reports:write'));
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('acme', 'web', expect.objectContaining({ name: 'ci-pipeline', scopes: ['reports:write'], projectIds: [] })),
    );
    expect(await screen.findByText('prdm_ci_abcd.SECRET')).toBeTruthy();

    const revoke = vi.spyOn(client, 'revokeCiToken').mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Revocar' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('acme', 'web', 'tok1'));
  });

  it('never offers mcp:* or import:write scopes for a CI token', async () => {
    vi.spyOn(client, 'listCiTokens').mockResolvedValue([]);
    renderProjectSettings('admin');

    await screen.findByRole('heading', { name: 'Tokens de CI' });
    expect(screen.queryByLabelText('mcp:read')).toBeNull();
    expect(screen.queryByLabelText('mcp:write')).toBeNull();
    expect(screen.queryByLabelText('import:write')).toBeNull();
  });
});
