import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { ProjectShell, useProjectShellContext } from '../../src/routes/ProjectShell.js';
import { makeOrgSummary, makeProjectOverview } from './fixtures.js';

function renderShell(initialPath = '/o/acme/p/web') {
  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug/p/:projectSlug', element: <ProjectShell />, children: [{ index: true, element: <p>planta</p> }] }],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
}

describe('ProjectShell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the sidebar and nested route once org/project data loads', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Ana Ríos' } });
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });

    renderShell();

    expect(await screen.findByText('planta')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeTruthy();
    expect(screen.getByText('Web')).toBeTruthy();
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Ana Ríos')).toBeTruthy();
  });

  it('shows a drift andon badge on the Drift nav item when driftErrors > 0', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview({ driftErrors: 3 })]);
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Ana Ríos' } });
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });

    renderShell();

    await screen.findByText('planta');
    expect(screen.getByText('3 errores de drift')).toBeTruthy();
  });

  it('shows "Organización no encontrada" for a slug the caller does not belong to', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
    vi.spyOn(client, 'getSession').mockResolvedValue(null);
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });

    renderShell('/o/nope/p/web');

    expect(await screen.findByText('Organización no encontrada')).toBeTruthy();
  });

  it('shows "Proyecto no encontrado" for a slug not in the org\'s overview', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
    vi.spyOn(client, 'getSession').mockResolvedValue(null);
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });

    renderShell('/o/acme/p/nope');

    expect(await screen.findByText('Proyecto no encontrado')).toBeTruthy();
  });

  it('shows the API error message on failure', async () => {
    vi.spyOn(client, 'listOrganizations').mockRejectedValue(new Error('boom'));

    renderShell();

    expect(await screen.findByText('Ocurrió un error inesperado. Probá de nuevo.')).toBeTruthy();
  });
});

/** Reads the shell's work-profile context the way the entry band will, and exposes a button to change it. */
function ProfileProbe(): ReactElement {
  const { workProfile, chooseWorkProfile } = useProjectShellContext();
  return (
    <div>
      <p>perfil: {workProfile ?? 'sin elegir'}</p>
      <button type="button" onClick={() => void chooseWorkProfile('developer').catch(() => undefined)}>
        elegir developer
      </button>
    </div>
  );
}

function renderShellWithProbe() {
  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug/p/:projectSlug', element: <ProjectShell />, children: [{ index: true, element: <ProfileProbe /> }] }],
    { initialEntries: ['/o/acme/p/web'] },
  );
  render(<RouterProvider router={router} />);
}

function mockShellBasics() {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
  vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Ana Ríos' } });
}

describe('ProjectShell — work profile (WO-544, SDD-051)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the stored profile through context before any nested screen renders', async () => {
    mockShellBasics();
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: 'producto' });

    renderShellWithProbe();

    // The first thing the nested screen ever sees is already the stored profile: never a flash of
    // "sin elegir" that the entry band would have to draw and then correct.
    expect(await screen.findByText('perfil: producto')).toBeTruthy();
    expect(screen.queryByText('perfil: sin elegir')).toBeNull();
  });

  it('reports "not chosen yet" as null, not as a default', async () => {
    mockShellBasics();
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });

    renderShellWithProbe();

    expect(await screen.findByText('perfil: sin elegir')).toBeTruthy();
  });

  it('asks for the profile in parallel with the rest, not after them: no extra round trip in series', async () => {
    // Nothing resolves until we say so: if the profile were fetched only after the other three settled,
    // getProfile would not have been called yet at the moment we assert.
    const never = new Promise<never>(() => undefined);
    const listOrganizations = vi.spyOn(client, 'listOrganizations').mockReturnValue(never);
    const getProjectsOverview = vi.spyOn(client, 'getProjectsOverview').mockReturnValue(never);
    const getSession = vi.spyOn(client, 'getSession').mockReturnValue(never);
    const getProfile = vi.spyOn(client, 'getProfile').mockReturnValue(never);

    renderShellWithProbe();

    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));
    expect(listOrganizations).toHaveBeenCalledTimes(1);
    expect(getProjectsOverview).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('a failure reading the profile does not take the project down: it degrades to "not chosen"', async () => {
    mockShellBasics();
    vi.spyOn(client, 'getProfile').mockRejectedValue(new Error('profile endpoint down'));

    renderShellWithProbe();

    // The shell still renders. A UX preference is not worth losing the whole project over.
    expect(await screen.findByText('perfil: sin elegir')).toBeTruthy();
    expect(screen.queryByText('profile endpoint down')).toBeNull();
  });

  it('choosing a profile shows it at once and sends it to the server', async () => {
    mockShellBasics();
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });
    const save = vi.spyOn(client, 'setWorkProfile').mockResolvedValue({ workProfile: 'developer' });

    renderShellWithProbe();
    await screen.findByText('perfil: sin elegir');
    await act(async () => {
      screen.getByRole('button', { name: 'elegir developer' }).click();
    });

    expect(save).toHaveBeenCalledWith({ workProfile: 'developer' });
    expect(await screen.findByText('perfil: developer')).toBeTruthy();
  });

  it('if the server refuses, the previous profile comes back: the band never shows a choice that was not kept', async () => {
    mockShellBasics();
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: 'negocio' });
    vi.spyOn(client, 'setWorkProfile').mockRejectedValue(new Error('nope'));

    renderShellWithProbe();
    await screen.findByText('perfil: negocio');
    await act(async () => {
      screen.getByRole('button', { name: 'elegir developer' }).click();
    });

    await waitFor(() => expect(screen.getByText('perfil: negocio')).toBeTruthy());
    expect(screen.queryByText('perfil: developer')).toBeNull();
  });
});
