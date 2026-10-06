/**
 * WO-547 (SDD-051/PRD-033 R1): the Planta's entry band, exercised through the real `ProjectShell` and the
 * real `Planta` -- not a hand-built context -- because what has to hold is the whole path: the profile the
 * server returns reaches the band before it renders, choosing one goes back to the server, and the band
 * redraws from that. Only the API client is faked, never the components.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineBoardDto, SuccessMetricsDto, WorkProfile } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { Planta } from '../../src/routes/Planta.js';
import { ProjectShell } from '../../src/routes/ProjectShell.js';
import { makeOrgSummary, makeProjectOverview } from './fixtures.js';

const METRICS: SuccessMetricsDto = {
  agentHumanEfficiency: { completedWorkOrders: 1, measuredWorkOrders: 1, avgResolutionHours: 0.1, medianResolutionHours: 0.083, unmeasured: { total: 0, workOrders: [] } },
  systemIntegrity: { governedTotal: 10, governedSynced: 10, syncedPercent: 100 },
  traceability: { featuresTotal: 1, featuresTraced: 1, orphanFeatures: [], featurePercent: 100, commitsTotal: 1, commitsWithRefs: 1, commitsTraced: 1, commitPercent: 100 },
};

const LINE_BOARD: LineBoardDto = {
  features: [{ id: 'BC-002', kind: 'BC', title: 'Reducir el churn', status: 'approved', station: 'caso_negocio', progress: { done: 0, total: 0, stopped: 0 }, children: [] }],
  andon: null,
};

const EMPTY_LINE_BOARD: LineBoardDto = { features: [], andon: null };

interface Options {
  profile?: WorkProfile | null;
  /** The literal answer of `GET /api/app/profile`, for a server whose answer is not the current shape. */
  profileAnswer?: unknown;
  lineBoard?: () => Promise<LineBoardDto>;
  myRole?: 'viewer' | 'editor' | 'admin';
}

function renderPlanta({ profile = null, profileAnswer, lineBoard = () => Promise.resolve(LINE_BOARD), myRole = 'editor' }: Options = {}) {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
  vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview({ myRole })]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Ana Ríos' } });
  vi.spyOn(client, 'getProfile').mockResolvedValue((profileAnswer ?? { handle: null, workProfile: profile }) as never);
  vi.spyOn(client, 'getLineBoard').mockImplementation(lineBoard);
  vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);

  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug/p/:projectSlug',
        element: <ProjectShell />,
        children: [
          { index: true, element: <Planta /> },
          // Where each path leads belongs to its own SDD; here they only need to exist to be reached.
          { path: 'construir/negocio', element: <p>destino: negocio</p> },
          { path: 'construir/producto', element: <p>destino: producto</p> },
          { path: 'construir/developer', element: <p>destino: developer</p> },
          { path: 'ajustes/*', element: <p>ajustes</p> },
        ],
      },
    ],
    { initialEntries: ['/o/acme/p/web'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const NEGOCIO = /Traigo una necesidad del negocio/;
const PRODUCTO = /Defino qué se construye/;
const DEVELOPER = /Escribo el código/;

describe('ProfileBand — against a server that predates the profile (production incident)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearQueryCache();
  });

  it('does not crash: it asks exactly as on a first visit when the server never heard of workProfile', async () => {
    renderPlanta({ profileAnswer: { handle: null } });

    expect(await screen.findByRole('heading', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Tu próximo paso' })).toBeNull();
  });

  it('does not crash on a profile value it does not know either', async () => {
    renderPlanta({ profileAnswer: { handle: null, workProfile: 'gerente' } });

    expect(await screen.findByRole('heading', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();
  });

  it('when that server cannot save the choice, it says so and asks again instead of pretending', async () => {
    renderPlanta({ profileAnswer: { handle: null } });
    vi.spyOn(client, 'setWorkProfile').mockRejectedValue(new client.ApiClientError(404, 'not_found', 'not found'));

    await userEvent.click(await screen.findByRole('button', { name: PRODUCTO }));

    expect((await screen.findByRole('alert')).textContent).toContain('No pudimos guardar tu elección');
    expect(screen.getByRole('heading', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();
  });
});

describe('ProfileBand — nothing chosen yet (WO-547, SDD-051)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearQueryCache();
  });

  it('asks what the person came to do, with the three profiles as plain-language options', async () => {
    renderPlanta();

    expect(await screen.findByRole('heading', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();
    const group = screen.getByRole('group', { name: '¿Qué venís a hacer acá?' });
    expect(within(group).getAllByRole('button')).toHaveLength(3);
    expect(within(group).getByRole('button', { name: NEGOCIO })).toBeTruthy();
    expect(within(group).getByRole('button', { name: PRODUCTO })).toBeTruthy();
    expect(within(group).getByRole('button', { name: DEVELOPER })).toBeTruthy();
  });

  it('R1: no acronym is ever offered as something to choose', async () => {
    renderPlanta();
    await screen.findByRole('heading', { name: '¿Qué venís a hacer acá?' });

    const group = screen.getByRole('group', { name: '¿Qué venís a hacer acá?' });
    for (const option of within(group).getAllByRole('button')) {
      expect(option.textContent).not.toMatch(/\b(BC|PRD|SDD|FR|WO|MRD|ADR|ART|FB)\b/);
    }
  });

  it('shows no "next step" summary before a profile exists', async () => {
    renderPlanta();
    await screen.findByRole('heading', { name: '¿Qué venís a hacer acá?' });

    expect(screen.queryByRole('region', { name: 'Tu próximo paso' })).toBeNull();
  });

  it('choosing one saves it and the band becomes that profile\'s next step, with a way out to build', async () => {
    const save = vi.spyOn(client, 'setWorkProfile').mockResolvedValue({ workProfile: 'producto' });
    renderPlanta();

    await userEvent.click(await screen.findByRole('button', { name: PRODUCTO }));

    expect(save).toHaveBeenCalledExactlyOnceWith({ workProfile: 'producto' });
    const summary = await screen.findByRole('region', { name: 'Tu próximo paso' });
    expect(within(summary).getByText('Convertir una iniciativa aprobada en requisitos')).toBeTruthy();
    expect(within(summary).getByRole('link', { name: 'Escribir los requisitos' }).getAttribute('href')).toBe('/o/acme/p/web/construir/producto');
    // ...and the chooser is gone: it asked once, it does not keep asking.
    expect(screen.queryByRole('group', { name: '¿Qué venís a hacer acá?' })).toBeNull();
  });

  it('moves focus to the new summary, so keyboard and screen-reader users are not dropped on the page', async () => {
    vi.spyOn(client, 'setWorkProfile').mockResolvedValue({ workProfile: 'negocio' });
    renderPlanta();

    await userEvent.click(await screen.findByRole('button', { name: NEGOCIO }));

    const summary = await screen.findByRole('region', { name: 'Tu próximo paso' });
    await waitFor(() => expect(document.activeElement).toBe(summary));
  });

  it('the choice shows at once, before the server answers: the chooser is gone, so it cannot be saved twice', async () => {
    let resolveSave: (value: { workProfile: WorkProfile }) => void = () => undefined;
    const save = vi.spyOn(client, 'setWorkProfile').mockReturnValue(new Promise((resolve) => (resolveSave = resolve)));
    renderPlanta();

    await userEvent.click(await screen.findByRole('button', { name: PRODUCTO }));

    // The save has not resolved and the band already shows the next step. There is no other plate left to
    // click, so nothing can be submitted a second time.
    expect(await screen.findByRole('region', { name: 'Tu próximo paso' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: DEVELOPER })).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => resolveSave({ workProfile: 'producto' }));
  });

  it('if saving fails it says so, keeps asking, and does not pretend a profile was chosen', async () => {
    vi.spyOn(client, 'setWorkProfile').mockRejectedValue(new Error('boom'));
    renderPlanta();

    await userEvent.click(await screen.findByRole('button', { name: DEVELOPER }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/No pudimos guardar tu elección/);
    // Back to asking: the optimistic choice was undone, so the band does not claim a profile that was not kept.
    expect(await screen.findByRole('group', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Tu próximo paso' })).toBeNull();
  });
});

describe('ProfileBand — the three paths (WO-547, SDD-051)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearQueryCache();
  });

  const PATHS: readonly { profile: WorkProfile; nextStep: string; action: string; destination: string }[] = [
    { profile: 'negocio', nextStep: 'Escribir el caso de negocio de una iniciativa nueva', action: 'Empezar el caso de negocio', destination: 'destino: negocio' },
    { profile: 'producto', nextStep: 'Convertir una iniciativa aprobada en requisitos', action: 'Escribir los requisitos', destination: 'destino: producto' },
    { profile: 'developer', nextStep: 'Conectar tu editor al proyecto para tomar órdenes', action: 'Conectar mi entorno', destination: 'destino: developer' },
  ];

  it.each(PATHS)('$profile: a stored profile shows its next step at once and leads to its own path', async ({ profile, nextStep, action, destination }) => {
    const router = renderPlanta({ profile });

    const summary = await screen.findByRole('region', { name: 'Tu próximo paso' });
    expect(within(summary).getByText(nextStep)).toBeTruthy();
    await userEvent.click(within(summary).getByRole('link', { name: action }));

    expect(await screen.findByText(destination)).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/o/acme/p/web/construir/${profile}`);
  });

  it('a person who already chose never sees the chooser flash first', async () => {
    renderPlanta({ profile: 'producto' });

    // The very first thing on screen once the shell is up is already the summary: the profile arrived
    // with the shell's own load, so there is no frame in which the band asks a question it knows.
    await screen.findByRole('region', { name: 'Tu próximo paso' });
    expect(screen.queryByRole('heading', { name: '¿Qué venís a hacer acá?' })).toBeNull();
  });
});

describe('ProfileBand — changing the profile in place (WO-547, SDD-051)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearQueryCache();
  });

  it('"Cambiar" reopens the choice right there, and choosing another updates the band', async () => {
    const save = vi.spyOn(client, 'setWorkProfile').mockResolvedValue({ workProfile: 'developer' });
    renderPlanta({ profile: 'negocio' });

    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar' }));
    expect(screen.getByRole('group', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: DEVELOPER }));

    expect(save).toHaveBeenCalledExactlyOnceWith({ workProfile: 'developer' });
    const summary = await screen.findByRole('region', { name: 'Tu próximo paso' });
    expect(within(summary).getByText('Conectar tu editor al proyecto para tomar órdenes')).toBeTruthy();
  });

  it('changing never goes through Ajustes: there is no link there, and the path stays on the Planta', async () => {
    vi.spyOn(client, 'setWorkProfile').mockResolvedValue({ workProfile: 'developer' });
    const router = renderPlanta({ profile: 'negocio' });

    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar' }));
    await userEvent.click(screen.getByRole('button', { name: DEVELOPER }));
    await screen.findByRole('region', { name: 'Tu próximo paso' });

    expect(router.state.location.pathname).toBe('/o/acme/p/web');
    // The sidebar legitimately has its own "Ajustes"; what matters is that the band never sends you there.
    const summary = screen.getByRole('region', { name: 'Tu próximo paso' });
    expect(within(summary).queryByRole('link', { name: /ajustes/i })).toBeNull();
  });

  it('"Cancelar" goes back to the summary without saving anything', async () => {
    const save = vi.spyOn(client, 'setWorkProfile').mockResolvedValue({ workProfile: 'negocio' });
    renderPlanta({ profile: 'negocio' });

    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByRole('region', { name: 'Tu próximo paso' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: '¿Qué venís a hacer acá?' })).toBeNull();
  });

  it('if the change cannot be saved, the previous profile is still the one shown once the person cancels', async () => {
    vi.spyOn(client, 'setWorkProfile').mockRejectedValue(new Error('boom'));
    renderPlanta({ profile: 'negocio' });

    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar' }));
    await userEvent.click(screen.getByRole('button', { name: DEVELOPER }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    const summary = await screen.findByRole('region', { name: 'Tu próximo paso' });
    expect(within(summary).getByText('Escribir el caso de negocio de una iniciativa nueva')).toBeTruthy();
  });
});

describe('ProfileBand — always present, and never a permission (WO-547, SDD-051)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearQueryCache();
  });

  it('is there while the line is still loading, not only after it arrives', async () => {
    renderPlanta({ lineBoard: () => new Promise<LineBoardDto>(() => undefined) });

    expect(await screen.findByRole('heading', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();
  });

  it('is there when the line fails to load, next to the error', async () => {
    renderPlanta({ lineBoard: () => Promise.reject(new Error('sin línea')) });

    expect(await screen.findByText('No pudimos cargar la planta')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();
  });

  it('is there above the empty state, which is exactly when someone most needs to be told where to start', async () => {
    renderPlanta({ lineBoard: () => Promise.resolve(EMPTY_LINE_BOARD) });

    expect(await screen.findByText('Todavía no hay features en la línea')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();
  });

  it('is not gated by role: a viewer gets the band and can choose, because a profile is not a permission', async () => {
    const save = vi.spyOn(client, 'setWorkProfile').mockResolvedValue({ workProfile: 'negocio' });
    renderPlanta({ myRole: 'viewer' });

    await userEvent.click(await screen.findByRole('button', { name: NEGOCIO }));

    expect(save).toHaveBeenCalledWith({ workProfile: 'negocio' });
  });

  it('does not touch the line: the seven stations are still there under the band', async () => {
    renderPlanta({ profile: 'producto' });

    expect(await screen.findByText('BC-002')).toBeTruthy();
    expect(screen.getAllByText('Caso de negocio').length).toBeGreaterThan(0);
  });
});
