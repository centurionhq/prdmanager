import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectSettingsSchema } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { AjustesGeneral } from '../../src/routes/AjustesGeneral.js';
import { makeProjectOverview, makeProjectShellContext } from './fixtures.js';

const FOLDERS = {
  MRD: 'docs/mrd',
  PRD: 'docs/prd',
  FR: 'docs/fr',
  SDD: 'docs/sdd',
  ADR: 'docs/adr',
  WO: 'docs/wo',
  ART: 'docs/art',
  FB: 'docs/fb',
};

const FULL_SETTINGS = {
  folders: FOLDERS,
  ignore: ['node_modules/**', 'dist/**'],
  git: { max_commits: 250, enforce_refs: true, enforce_refs_since: 'abc1234' },
  triage: { auto_link_min_score: 0.5, auto_link_margin: 1.05, max_candidates: 5, min_matched_terms: 2 },
  lifecycle: { grandfathered: [{ id: 'PRD-001', hash: 'a'.repeat(64) }] },
  default_branch: 'main',
  github_repository: 'acme/web',
  github_repository_id: 42,
  github_owner_id: 7,
  hash_algo_version: 2,
};

function renderAjustesGeneral(defaultBranch = 'main') {
  const settings = projectSettingsSchema.parse({ ...FULL_SETTINGS, default_branch: defaultBranch });
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

  it('shows the nine settings fields with their values', () => {
    renderAjustesGeneral('main');

    expect(screen.getByLabelText('Rama por defecto')).toHaveProperty('value', 'main');
    const folderLabels = {
      MRD: 'Mercado (MRD)',
      PRD: 'Producto (PRD)',
      FR: 'Feature request (FR)',
      SDD: 'Blueprint (SDD)',
      ADR: 'Decisión (ADR)',
      WO: 'Orden de trabajo (WO)',
      ART: 'Artefacto (ART)',
      FB: 'Feedback (FB)',
    };
    for (const [kind, label] of Object.entries(folderLabels)) {
      expect(screen.getByLabelText(label)).toHaveProperty('value', FOLDERS[kind as keyof typeof FOLDERS]);
    }
    expect(screen.getByLabelText('Patrones ignorados')).toHaveProperty('value', 'node_modules/**\ndist/**');
    expect(screen.getByLabelText('Commits a mirar')).toHaveProperty('value', '250');
    expect(screen.getByLabelText('Exigir el trailer desde')).toHaveProperty('value', 'abc1234');
    expect(screen.getByLabelText('Puntaje mínimo del candidato')).toHaveProperty('value', '0.5');
    expect(screen.getByLabelText('Ventaja sobre el segundo')).toHaveProperty('value', '1.05');
    expect(screen.getByLabelText('Candidatas a comparar')).toHaveProperty('value', '5');
    expect(screen.getByLabelText('Términos en común')).toHaveProperty('value', '2');
    expect(screen.getByRole('checkbox', { name: /Exigir el trailer/ })).toHaveProperty('checked', true);
  });

  it('sends the complete settings object with only the edited fields changed', async () => {
    renderAjustesGeneral('main');
    const update = vi.spyOn(client, 'updateProjectSettings').mockImplementation(async (_orgSlug, _projectSlug, input) => ({
      id: 'proj1',
      slug: 'web',
      name: 'Web',
      graphProjectId: 'prj_abc',
      settings: input.settings,
      archivedAt: null,
    }));

    const folder = screen.getByLabelText('Decisión (ADR)');
    await userEvent.clear(folder);
    await userEvent.type(folder, 'docs/decisions');
    const score = screen.getByLabelText('Puntaje mínimo del candidato');
    await userEvent.clear(score);
    await userEvent.type(score, '0.8');
    await userEvent.click(screen.getByRole('checkbox', { name: /Exigir el trailer/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('acme', 'web', {
      settings: {
        folders: { ...FOLDERS, ADR: 'docs/decisions' },
        ignore: ['node_modules/**', 'dist/**'],
        git: { max_commits: 250, enforce_refs: false, enforce_refs_since: 'abc1234' },
        triage: { auto_link_min_score: 0.8, auto_link_margin: 1.05, max_candidates: 5, min_matched_terms: 2 },
        lifecycle: { grandfathered: [{ id: 'PRD-001', hash: 'a'.repeat(64) }] },
        default_branch: 'main',
        github_repository: 'acme/web',
        github_repository_id: 42,
        github_owner_id: 7,
        hash_algo_version: 2,
      },
    });
  });

  it('does not send an invalid sha and explains why', async () => {
    renderAjustesGeneral('main');
    const update = vi.spyOn(client, 'updateProjectSettings');

    const since = screen.getByLabelText('Exigir el trailer desde');
    await userEvent.clear(since);
    await userEvent.type(since, 'zzz');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Escribí un sha de 7 a 40 caracteres hexadecimales, o dejá el campo vacío.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('shows what another process decides without an editable input', () => {
    renderAjustesGeneral('main');

    const readOnly = {
      'Documentos exentos del baseline': 'PRD-001',
      'Repositorio de GitHub': 'acme/web',
      'Id del repositorio': '42',
      'Id del dueño en GitHub': '7',
      'Versión del algoritmo de hash': '2',
    };
    for (const [name, value] of Object.entries(readOnly)) {
      expect(screen.queryByRole('textbox', { name })).toBeNull();
      expect(within(screen.getByRole('group', { name })).getByText(value)).toBeTruthy();
    }
  });
});
