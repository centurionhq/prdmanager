import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectSettingsSchema } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { AjustesGeneral } from '../../src/routes/AjustesGeneral.js';
import { makeProjectOverview, makeProjectShellContext } from './fixtures.js';

function renderAjustesGeneral(defaultBranch = 'main') {
  const settings = projectSettingsSchema.parse({ default_branch: defaultBranch });
  const context = makeProjectShellContext('admin');
  const project = makeProjectOverview({ ...context.project, settings });
  const router = createMemoryRouter(
    [
      {
        path: '/ctx',
        element: <Outlet context={{ ...context, project }} />,
        children: [{ index: true, element: <AjustesGeneral /> }],
      },
    ],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('AjustesGeneral', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the project identity and its current default branch', () => {
    renderAjustesGeneral('main');

    expect(screen.getByText('Web')).toBeTruthy();
    expect(screen.getByLabelText('Rama por defecto')).toHaveProperty('value', 'main');
  });

  it('saves a new default branch', async () => {
    renderAjustesGeneral('main');
    const update = vi.spyOn(client, 'updateProjectSettings').mockImplementation(async (_orgSlug, _projectSlug, input) => ({
      id: 'proj1',
      slug: 'web',
      name: 'Web',
      graphProjectId: 'prj_abc',
      settings: input.settings,
      archivedAt: null,
    }));

    const input = screen.getByLabelText('Rama por defecto');
    await userEvent.clear(input);
    await userEvent.type(input, 'develop');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('acme', 'web', { settings: expect.objectContaining({ default_branch: 'develop' }) }),
    );
    expect(await screen.findByText('Guardado.')).toBeTruthy();
  });

  it('surfaces a server error without crashing', async () => {
    renderAjustesGeneral('main');
    vi.spyOn(client, 'updateProjectSettings').mockRejectedValue(new client.ApiClientError(422, 'validation_error', 'invalid branch'));

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('invalid branch')).toBeTruthy();
  });
});
