import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineBoardDto, SuccessMetricsDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { Planta } from '../../src/routes/Planta.js';
import { makeProjectShellContext, makeProjectOverview } from './fixtures.js';

const METRICS: SuccessMetricsDto = {
  agentHumanEfficiency: { completedWorkOrders: 10, measuredWorkOrders: 10, avgResolutionHours: 0.1, medianResolutionHours: 0.083 },
  systemIntegrity: { governedTotal: 100, governedSynced: 99, syncedPercent: 99.6 },
  traceability: { featuresTotal: 4, featuresTraced: 4, featurePercent: 100, commitsTotal: 10, commitsWithRefs: 7, commitsTraced: 6, commitPercent: 66.4 },
};

const EMPTY_METRICS: SuccessMetricsDto = {
  agentHumanEfficiency: { completedWorkOrders: 0, measuredWorkOrders: 0, avgResolutionHours: null, medianResolutionHours: null },
  systemIntegrity: { governedTotal: 0, governedSynced: 0, syncedPercent: null },
  traceability: { featuresTotal: 0, featuresTraced: 0, featurePercent: null, commitsTotal: 0, commitsWithRefs: 0, commitsTraced: 0, commitPercent: null },
};

/**
 * WO-446 (SDD-024/PRD-011 §4.4/§4.5): one row per initiative, exercising every shape the board can show --
 * a BC with a nested PRD (row collapsing, WO-443), a BC with no PRD yet (still visible, PRD-011 §4.4's own
 * acceptance criterion), a legacy top-level PRD without a BC, and a plain FR row (unaffected by any of this).
 */
const LINE_BOARD: LineBoardDto = {
  features: [
    {
      id: 'BC-001',
      kind: 'BC',
      title: 'Importador incremental de repos',
      status: 'approved',
      station: 'construccion',
      andonStation: 'construccion',
      progress: { done: 14, total: 22, stopped: 3 },
      children: [{ id: 'PRD-010', kind: 'PRD', title: 'Importador', status: 'approved', station: 'diseno_tecnico', progress: { done: 0, total: 0, stopped: 0 }, children: [] }],
    },
    {
      id: 'BC-002',
      kind: 'BC',
      title: 'Reducir el churn de cuentas',
      status: 'approved',
      station: 'caso_negocio',
      progress: { done: 0, total: 0, stopped: 0 },
      children: [],
    },
    {
      id: 'PRD-006',
      kind: 'PRD',
      title: 'Rediseño del frontend',
      status: 'draft',
      station: 'diseno_tecnico',
      progress: { done: 0, total: 0, stopped: 0 },
      children: [],
    },
    {
      id: 'FR-001',
      kind: 'FR',
      title: 'Persistencia de borradores',
      status: 'in_progress',
      station: 'entregado',
      progress: { done: 4, total: 4, stopped: 0 },
      children: [],
    },
  ],
  andon: { featureId: 'BC-001', station: 'construccion' },
};

function renderPlanta(overrides: Parameters<typeof makeProjectOverview>[0] = {}) {
  const context = makeProjectShellContext('owner');
  const project = makeProjectOverview({ slug: context.projectSlug, ...overrides });
  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug/p/:projectSlug',
        element: <Outlet context={{ ...context, project }} />,
        children: [
          { index: true, element: <Planta /> },
          { path: 'arbol/:id', element: <p>arbol screen</p> },
          { path: 'drift', element: <p>drift screen</p> },
        ],
      },
    ],
    { initialEntries: [`/o/${context.orgSlug}/p/${project.slug}`] },
  );
  render(<RouterProvider router={router} />);
}

describe('Planta', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearQueryCache();
  });

  it('renders the seven stations and one row per top-level initiative with its progress', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    expect(await screen.findByText('BC-001')).toBeTruthy();
    expect(screen.getByText('Importador incremental de repos')).toBeTruthy();
    // The 375px layout (`LineBoard.module.css`'s `@media (max-width: 767px)`) renders a second, CSS-only
    // hidden copy of a row's own current station next to the desktop rail -- real browsers exclude
    // `display: none` content from the accessibility tree, but jsdom doesn't apply external stylesheet
    // rules at all, so both copies are present here. `getAllByText` documents that instead of fighting it.
    expect(screen.getAllByText(/14\/22/).length).toBeGreaterThan(0);
    for (const label of ['Entrada', 'Caso de negocio', 'Producto', 'Diseño técnico', 'Planificación', 'Construcción', 'Entregado']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('nests a PRD under its BC row instead of giving it a row of its own (WO-443 row collapsing)', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    await screen.findByText('BC-001');
    expect(screen.getByText('PRD-010')).toBeTruthy();
    expect(screen.queryAllByRole('link').some((link) => link.textContent?.startsWith('PRD-010'))).toBe(false);
  });

  it('a BC with no PRD/FR yet is still visible on the line (PRD-011 §4.4)', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    expect(await screen.findByText('BC-002')).toBeTruthy();
    expect(screen.getByText('sin PRD/FR todavía')).toBeTruthy();
  });

  it('a legacy PRD without a BC keeps its own row and names what it is missing', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    expect(await screen.findByText('PRD-006')).toBeTruthy();
    // WO-451: FR-001 (also in this fixture) now gets the same annotation, so "sin caso de negocio" is no
    // longer unique -- assert it's attached to PRD-006's own row specifically.
    expect(screen.getAllByText('sin caso de negocio').length).toBeGreaterThan(0);
  });

  it('a legacy FR without a BC keeps its own row and names what it is missing (WO-451, SDD-025)', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    expect(await screen.findByText('FR-001')).toBeTruthy();
    expect(screen.getAllByText('sin caso de negocio').length).toBeGreaterThan(0);
  });

  it('renders the real metrics as KPIs', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    expect(await screen.findByText('5 min')).toBeTruthy();
    expect(screen.getByText('99,6 %')).toBeTruthy();
    expect(screen.getByText('100 %')).toBeTruthy();
    expect(screen.getByText('66,4 %')).toBeTruthy();
  });

  it('explains missing metrics instead of showing a fabricated 0% when awaiting the first report', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(EMPTY_METRICS);
    renderPlanta({ awaitingFirstReport: true });

    expect(await screen.findAllByText(/esperando el primer reporte de ci/i)).not.toHaveLength(0);
  });

  it('clicking a feature row navigates to its node in the feature tree', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    await userEvent.click(await screen.findByRole('link', { name: /FR-001/ }));
    expect(await screen.findByText('arbol screen')).toBeTruthy();
  });

  it('shows the andon on the BC row and clicking it navigates to the drift screen filtered by that feature', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    expect(await screen.findByText(/línea detenida en construcción/i)).toBeTruthy();
    await userEvent.click(await screen.findByRole('link', { name: /paradas/ }));
    expect(await screen.findByText('drift screen')).toBeTruthy();
  });

  it('shows an empty state when there are no features on the line', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue({ features: [], andon: null });
    vi.spyOn(client, 'getMetrics').mockResolvedValue(EMPTY_METRICS);
    renderPlanta();

    expect(await screen.findByText(/todavía no hay features en la línea/i)).toBeTruthy();
  });

  it('shows an error state when the line board fails to load', async () => {
    vi.spyOn(client, 'getLineBoard').mockRejectedValue(new Error('line board down'));
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    expect(await screen.findByText(/no pudimos cargar la planta/i)).toBeTruthy();
  });
});
