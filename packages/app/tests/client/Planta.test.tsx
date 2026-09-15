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

const LINE_BOARD: LineBoardDto = {
  features: [
    {
      id: 'FR-002',
      kind: 'FR',
      title: 'Importador incremental de repos',
      status: 'in_progress',
      station: 'ejecucion',
      andonStation: 'ejecucion',
      progress: { done: 14, total: 22, stopped: 3 },
    },
    {
      id: 'FR-001',
      kind: 'FR',
      title: 'Persistencia de borradores',
      status: 'in_progress',
      station: 'cierre',
      progress: { done: 4, total: 4, stopped: 0 },
    },
  ],
  andon: { featureId: 'FR-002', station: 'ejecucion' },
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

  it('renders the six stations and one row per feature with its progress', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

    expect(await screen.findByText('FR-002')).toBeTruthy();
    expect(screen.getByText('Importador incremental de repos')).toBeTruthy();
    expect(screen.getByText(/14\/22/)).toBeTruthy();
    expect(screen.getByText('Ejecución')).toBeTruthy();
    expect(screen.getByText('Cierre')).toBeTruthy();
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

  it('clicking the andon navigates to the drift screen filtered by that feature', async () => {
    vi.spyOn(client, 'getLineBoard').mockResolvedValue(LINE_BOARD);
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
    renderPlanta();

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
