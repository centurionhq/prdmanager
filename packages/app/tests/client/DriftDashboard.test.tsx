import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriftDashboardDto, DriftReportSummaryDto } from '@prdm/contracts';
import { DriftDashboard } from '../../src/routes/DriftDashboard.js';
import * as driftReportsApi from '../../src/api/drift-reports.js';
import * as orgShell from '../../src/routes/OrgShell.js';

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ projectSlug: 'web' }) };
});

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

function mockOrgShell(): void {
  vi.spyOn(orgShell, 'useOrgShellContext').mockReturnValue({
    orgSlug: 'acme',
    currentOrg: { id: 'org1', slug: 'acme', name: 'Acme', role: 'member' },
  } as never);
}

describe('DriftDashboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the official report with its verifying token and head_sha, never a preview in its place', async () => {
    mockOrgShell();
    const dashboard: DriftDashboardDto = {
      official: fakeReport({ id: 'official-1', mode: 'baseline', tokenName: 'ci-pipeline', headSha: 'b'.repeat(40), branch: 'main', issueCount: 2 }),
      previews: [],
      history: [],
    };
    vi.spyOn(driftReportsApi, 'getDriftDashboard').mockResolvedValue(dashboard);

    render(<DriftDashboard />);

    const officialSection = await screen.findByRole('heading', { name: 'Rama por defecto (oficial)' });
    const section = officialSection.closest('section')!;
    expect(within(section).getByText(/ci-pipeline/)).toBeTruthy();
    expect(within(section).getByText(/bbbbbbbbbbbb/)).toBeTruthy();
    expect(within(section).getByText('Oficial')).toBeTruthy();
    expect(within(section).queryByText('Vista previa')).toBeNull();
  });

  it('shows an empty state when the default branch has never had an official report', async () => {
    mockOrgShell();
    vi.spyOn(driftReportsApi, 'getDriftDashboard').mockResolvedValue({ official: null, previews: [], history: [] });

    render(<DriftDashboard />);

    expect(await screen.findByText(/Todavía no hay un reporte oficial/)).toBeTruthy();
  });

  it('lists preview drift by branch, clearly labeled as unofficial', async () => {
    mockOrgShell();
    const dashboard: DriftDashboardDto = {
      official: null,
      previews: [
        fakeReport({ id: 'p1', branch: 'feature/x', tokenName: 'ana-personal' }),
        fakeReport({ id: 'p2', branch: 'feature/y', tokenName: 'bob-personal', headSha: 'c'.repeat(40) }),
      ],
      history: [],
    };
    vi.spyOn(driftReportsApi, 'getDriftDashboard').mockResolvedValue(dashboard);

    render(<DriftDashboard />);

    const previewsHeading = await screen.findByRole('heading', { name: 'Vistas previas por rama' });
    const section = previewsHeading.closest('section')!;
    expect(within(section).getByText(/feature\/x/)).toBeTruthy();
    expect(within(section).getByText(/feature\/y/)).toBeTruthy();
    expect(within(section).getAllByText('Vista previa')).toHaveLength(2);
  });

  it('lists the full chronological history with trust level, token, timestamp and issue count', async () => {
    mockOrgShell();
    const dashboard: DriftDashboardDto = {
      official: fakeReport({ id: 'h1', mode: 'baseline', tokenName: 'ci-pipeline', branch: 'main' }),
      previews: [],
      history: [
        fakeReport({ id: 'h1', mode: 'baseline', tokenName: 'ci-pipeline', branch: 'main', createdAt: '2026-01-02T00:00:00.000Z' }),
        fakeReport({ id: 'h2', mode: 'preview', tokenName: 'ana-personal', branch: 'feature/x', issueCount: 3, createdAt: '2026-01-01T00:00:00.000Z' }),
      ],
    };
    vi.spyOn(driftReportsApi, 'getDriftDashboard').mockResolvedValue(dashboard);

    render(<DriftDashboard />);

    const historyHeading = await screen.findByRole('heading', { name: 'Historial de reportes' });
    const section = historyHeading.closest('section')!;
    const table = within(section).getByRole('table');
    const rows = within(table).getAllByRole('row');
    // header + 2 data rows
    expect(rows).toHaveLength(3);
    expect(within(table).getByText('ci-pipeline')).toBeTruthy();
    expect(within(table).getByText('ana-personal')).toBeTruthy();
    expect(within(table).getByText('3')).toBeTruthy();
  });

  it('surfaces a load error', async () => {
    mockOrgShell();
    vi.spyOn(driftReportsApi, 'getDriftDashboard').mockRejectedValue(new Error('boom'));

    render(<DriftDashboard />);

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
