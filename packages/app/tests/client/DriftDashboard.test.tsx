import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriftDashboardDto, DriftIssueDto, DriftReportDetailDto, DriftReportSummaryDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import * as graphApi from '../../src/api/graph.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { DriftDashboard } from '../../src/routes/DriftDashboard.js';
import { makeProjectShellContext } from './fixtures.js';

function fakeReport(overrides: Partial<DriftReportSummaryDto> = {}): DriftReportSummaryDto {
  return {
    id: 'r1',
    mode: 'preview',
    headSha: 'a'.repeat(40),
    branch: 'feature/x',
    tokenName: 'ana-personal',
    issueCount: 0,
    hasBlockingIssues: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeIssue(overrides: Partial<DriftIssueDto> = {}): DriftIssueDto {
  return {
    kind: 'code_out_of_sync',
    severity: 'error',
    nodeId: 'SDD-012',
    target: 'packages/cli/src/import.ts',
    message: 'packages/cli/src/import.ts is out of sync with SDD-012',
    id: 'a1b2c3',
    featureIds: ['FR-002'],
    blueprintId: 'SDD-012',
    station: 'ejecucion',
    detectedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(): void {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext('owner', 'admin')} />, children: [{ index: true, element: <DriftDashboard /> }] }],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('DriftDashboard', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('shows the official report head_sha and branch, never treating a preview as official', async () => {
    const dashboard: DriftDashboardDto = {
      official: fakeReport({ id: 'official-1', mode: 'baseline', tokenName: 'ci-pipeline', headSha: 'b'.repeat(40), branch: 'main', issueCount: 2 }),
      previews: [],
      history: [],
    };
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue(dashboard);
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('main')).toBeTruthy();
    expect(screen.getByText('bbbbbbbbbbbb')).toBeTruthy();
    expect(screen.queryByText(/Todavía no hay un reporte oficial/)).toBeNull();
  });

  it('shows a warning banner when the default branch has never had an official report', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({ official: null, previews: [], history: [] });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/Todavía no hay un reporte oficial verificado por CI/)).toBeTruthy();
    expect(screen.getByText(/Esperando el primer reporte de CI verificado/)).toBeTruthy();
  });

  it('lists preview drift by branch, clearly labeled as unofficial', async () => {
    const dashboard: DriftDashboardDto = {
      official: null,
      previews: [
        fakeReport({ id: 'p1', branch: 'feature/x', tokenName: 'ana-personal' }),
        fakeReport({ id: 'p2', branch: 'feature/y', tokenName: 'bob-personal', headSha: 'c'.repeat(40) }),
      ],
      history: [],
    };
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue(dashboard);
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);

    renderPage();

    const previewsHeading = await screen.findByRole('heading', { name: 'Previews por rama' });
    const section = previewsHeading.closest('div')!;
    expect(within(section).getByText('feature/x')).toBeTruthy();
    expect(within(section).getByText('feature/y')).toBeTruthy();
    expect(within(section).getAllByText('vista previa')).toHaveLength(2);
  });

  it('groups the real drift issues by kind, with their attributed blueprint', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({ official: fakeReport({ mode: 'baseline', branch: 'main' }), previews: [], history: [] });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([
      fakeIssue(),
      fakeIssue({ id: 'd4e5f6', kind: 'awaiting_ci_report', severity: 'warning', message: 'feat/fr-002-importer todavía no recibió un reporte de CI', blueprintId: null }),
    ]);

    renderPage();

    const codeGroupHeader = await screen.findByText('Código fuera de sincronía');
    expect(screen.getByText('Esperando reporte de CI')).toBeTruthy();
    expect(screen.getAllByText('SDD-012').length).toBeGreaterThan(0);
    expect(within(codeGroupHeader.parentElement!).getByText('1')).toBeTruthy();
  });

  it('lists the full chronological history and opens a report detail on click', async () => {
    const history = [
      fakeReport({ id: 'h1', mode: 'baseline', tokenName: 'ci-pipeline', branch: 'main', createdAt: '2026-01-02T00:00:00.000Z', issueCount: 3 }),
      fakeReport({ id: 'h2', mode: 'preview', tokenName: 'ana-personal', branch: 'feature/x', issueCount: 3, createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({ official: fakeReport({ mode: 'baseline', branch: 'main' }), previews: [], history });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);
    const detail: DriftReportDetailDto = {
      id: 'h1',
      mode: 'baseline',
      headSha: 'a'.repeat(40),
      branch: 'main',
      tokenName: 'ci-pipeline',
      issueCount: 1,
      hasBlockingIssues: true,
      createdAt: '2026-01-02T00:00:00.000Z',
      issues: [fakeIssue()],
    };
    vi.spyOn(client, 'getDriftReportDetail').mockResolvedValue(detail);

    renderPage();

    const historyHeading = await screen.findByRole('heading', { name: 'Historial' });
    const section = historyHeading.closest('div')!;
    const table = within(section).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 data rows
    expect(within(table).getByText('ci-pipeline')).toBeTruthy();
    expect(within(table).getByText('ana-personal')).toBeTruthy();

    await userEvent.click(within(table).getByText('ci-pipeline'));

    expect(await screen.findByRole('dialog', { name: 'Detalle del reporte' })).toBeTruthy();
    expect(await screen.findByText(/packages\/cli\/src\/import\.ts is out of sync/)).toBeTruthy();
  });

  it('acknowledges drift and shows a success toast', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({ official: fakeReport({ mode: 'baseline', branch: 'main' }), previews: [], history: [] });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([fakeIssue()]);
    const acknowledge = vi.spyOn(graphApi, 'acknowledgeDrift').mockResolvedValue({ report: {} as never });

    renderPage();
    await screen.findByText('Código fuera de sincronía');

    await userEvent.click(screen.getByRole('button', { name: 'Reconocer drift' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reconocer drift' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconocer drift' }));

    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('acme', 'web', 'SDD-012'));
    expect(await screen.findByText('Drift reconocido')).toBeTruthy();
  });

  it('surfaces a load error', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockRejectedValue(new Error('boom'));
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);

    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
