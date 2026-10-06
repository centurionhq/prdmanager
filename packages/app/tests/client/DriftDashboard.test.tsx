import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriftDashboardDto, DriftIssueDto, DriftReportDetailDto, DriftReportSummaryDto, ProjectSettings } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import * as graphApi from '../../src/api/graph.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { formatDateTime } from '../../src/lib/format-date.js';
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
    station: 'construccion',
    detectedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(settings: Partial<ProjectSettings> = {}): void {
  const router = createMemoryRouter(
    [
      {
        path: '/ctx',
        element: <Outlet context={makeProjectShellContext('owner', 'admin', null, undefined, settings)} />,
        children: [{ index: true, element: <DriftDashboard /> }],
      },
    ],
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
    const section = previewsHeading.closest('section')!;
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

    const issuesRegion = await screen.findByRole('region', { name: 'Issues de drift' });
    const codeGroupHeader = within(issuesRegion).getByText('Código fuera de sincronía');
    expect(within(issuesRegion).getByText('Esperando reporte de CI')).toBeTruthy();
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

    const dialog = await screen.findByRole('dialog', { name: 'Detalle del reporte' });
    await waitFor(() => expect(dialog.textContent).toContain('packages/cli/src/import.ts no coincide con SDD-012'));
  });

  it('acknowledges drift and shows a success toast', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({ official: fakeReport({ mode: 'baseline', branch: 'main' }), previews: [], history: [] });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([fakeIssue()]);
    const acknowledge = vi.spyOn(graphApi, 'acknowledgeDrift').mockResolvedValue({ report: {} as never });

    renderPage();
    await screen.findByRole('region', { name: 'Issues de drift' });

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

  it('authorizes a force-push override and shows a success toast', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({ official: fakeReport({ mode: 'baseline', branch: 'main' }), previews: [], history: [] });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);
    const authorize = vi.spyOn(graphApi, 'authorizeForcePushOverride').mockResolvedValue({ headSha: 'c'.repeat(40) });

    renderPage();
    await screen.findByRole('button', { name: 'Autorizar force-push' });

    await userEvent.click(screen.getByRole('button', { name: 'Autorizar force-push' }));
    const dialog = await screen.findByRole('dialog', { name: 'Autorizar force-push' });

    const confirmButton = within(dialog).getByRole('button', { name: 'Autorizar' }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    await userEvent.type(within(dialog).getByLabelText('Commit (head_sha) a autorizar'), 'c'.repeat(40));
    expect(confirmButton.disabled).toBe(false);
    await userEvent.click(confirmButton);

    await waitFor(() => expect(authorize).toHaveBeenCalledWith('acme', 'web', 'c'.repeat(40)));
    expect(await screen.findByText('Force-push autorizado')).toBeTruthy();
  });

  it('keeps the force-push confirm button disabled for a sha that is too short', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({ official: fakeReport({ mode: 'baseline', branch: 'main' }), previews: [], history: [] });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);

    renderPage();
    await screen.findByRole('button', { name: 'Autorizar force-push' });

    await userEvent.click(screen.getByRole('button', { name: 'Autorizar force-push' }));
    const dialog = await screen.findByRole('dialog', { name: 'Autorizar force-push' });

    await userEvent.type(within(dialog).getByLabelText('Commit (head_sha) a autorizar'), 'abc123');
    expect((within(dialog).getByRole('button', { name: 'Autorizar' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// SDD-061 / WO-618 — triage of the issues list: collapse, combined filters, search, pagination and the
// KPIs as severity filters. The fixture reproduces the real case that motivated the feature.
// ---------------------------------------------------------------------------------------------------

/** The real shape of the screen: 229 issues, 226 of them a single `kind` over three blueprints plus the
 * explicit "Sin blueprint" bucket, and 3 warnings of a small, different kind. */
function triageIssues(): DriftIssueDto[] {
  const issues: DriftIssueDto[] = [];
  let seq = 0;
  const add = (overrides: Partial<DriftIssueDto>): void => {
    seq += 1;
    issues.push(fakeIssue({ id: `is-${String(seq).padStart(3, '0')}`, ...overrides }));
  };

  for (let i = 0; i < 100; i += 1) {
    add({ blueprintId: 'SDD-010', nodeId: 'SDD-010', target: `packages/core/src/core-${i}.ts`, message: `packages/core/src/core-${i}.ts is out of sync with SDD-010` });
  }
  for (let i = 0; i < 80; i += 1) {
    add({ blueprintId: 'SDD-002', nodeId: 'SDD-002', target: `packages/app/src/app-${i}.tsx`, message: `packages/app/src/app-${i}.tsx is out of sync with SDD-002` });
  }
  for (let i = 0; i < 40; i += 1) {
    add({ blueprintId: 'SDD-030', nodeId: 'SDD-030', target: `packages/ui/src/ui-${i}.ts`, message: `packages/ui/src/ui-${i}.ts is out of sync with SDD-030` });
  }
  for (let i = 0; i < 6; i += 1) {
    add({ blueprintId: null, nodeId: 'ADR-004', target: `docs/adr/ADR-004-${i}.md`, message: `archivo sin atribución ${i}` });
  }
  add({ kind: 'broken_link', severity: 'warning', blueprintId: 'SDD-013', nodeId: 'FR-009', target: 'docs/prd/PRD-041.md', featureIds: ['FR-011'], message: 'enlace roto hacia docs/prd/PRD-041.md' });
  add({ kind: 'broken_link', severity: 'warning', blueprintId: 'SDD-013', nodeId: 'FR-012', target: 'docs/prd/PRD-012.md', featureIds: ['FR-013'], message: 'enlace roto hacia docs/prd/PRD-012.md' });
  add({ kind: 'broken_link', severity: 'warning', blueprintId: 'SDD-020', nodeId: 'FR-020', target: 'docs/prd/PRD-020.md', featureIds: ['FR-021'], message: 'enlace roto hacia docs/prd/PRD-020.md' });
  return issues;
}

const TRIAGE_ISSUES = triageIssues();
const TRIAGE_TOTAL = TRIAGE_ISSUES.length; // 229

function renderDrift(issues: readonly DriftIssueDto[]): void {
  vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({
    official: fakeReport({ id: 'official-1', mode: 'baseline', tokenName: 'ci-pipeline', branch: 'main', issueCount: issues.length }),
    previews: [],
    history: [],
  });
  vi.spyOn(client, 'getDriftIssues').mockResolvedValue([...issues]);
  renderPage();
}

function issuesRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Issues de drift' });
}

/** The `<details>` of a top-level group (kind), located by the label its `<summary>` shows. */
function groupFor(region: HTMLElement, label: string): HTMLDetailsElement {
  const found = Array.from(region.querySelectorAll<HTMLDetailsElement>(':scope > div > details')).find((details) =>
    details.querySelector(':scope > summary')?.textContent?.includes(label),
  );
  if (!found) throw new Error(`no <details> group for ${label}`);
  return found;
}

/** The `<details>` of a subgroup (blueprint) inside a group, located by the id its `<summary>` shows. */
function subgroupFor(group: HTMLDetailsElement, blueprintId: string): HTMLDetailsElement {
  const found = Array.from(group.querySelectorAll<HTMLDetailsElement>(':scope > details')).find((details) =>
    details.querySelector(':scope > summary')?.textContent?.includes(blueprintId),
  );
  if (!found) throw new Error(`no <details> subgroup for ${blueprintId}`);
  return found;
}

function summaryOf(details: HTMLDetailsElement): HTMLElement {
  const summary = details.querySelector<HTMLElement>(':scope > summary');
  if (!summary) throw new Error('the group/subgroup header is not a <summary>');
  return summary;
}

function kpiButton(name: 'errores' | 'avisos'): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(name) });
}

function triageSummary(count: number): string {
  return `${count} de ${TRIAGE_TOTAL} issues`;
}

describe('DriftDashboard · triage (SDD-061)', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('starts every group and subgroup open and collapses it from its own summary', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });

    const group = groupFor(issuesRegion(), 'Código fuera de sincronía');
    expect(group.open).toBe(true);
    await userEvent.click(summaryOf(group));
    expect(group.open).toBe(false);
    await userEvent.click(summaryOf(group));
    expect(group.open).toBe(true);

    const subgroup = subgroupFor(group, 'SDD-010');
    expect(subgroup.open).toBe(true);
    await userEvent.click(summaryOf(subgroup));
    expect(subgroup.open).toBe(false);
    // SDD-061 chose the native <details>/<summary> over conditional rendering: the browser stops painting a
    // collapsed subtree but keeps it mounted, so the collapse is asserted on `open` (jsdom has no layout).
    expect(summaryOf(subgroup).textContent).toContain('SDD-010');
  });

  it('does not rebuild the 226-row wall: each subgroup renders at most PAGE_SIZE rows', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });

    const region = issuesRegion();
    const group = groupFor(region, 'Código fuera de sincronía');
    const subgroups = Array.from(group.querySelectorAll<HTMLDetailsElement>(':scope > details'));

    // SDD-002 (80 → 50), SDD-010 (100 → 50), SDD-030 (40) and the 6 unattributed ones.
    expect(subgroups.map((subgroup) => subgroup.querySelectorAll('ul > li').length)).toEqual([50, 50, 40, 6]);
    // 146 code_out_of_sync rows + 3 broken_link rows, not the 229 rows of the raw list.
    expect(region.querySelectorAll('ul > li').length).toBe(149);
  });

  it('paginates each subgroup with "Mostrar 50 más (quedan N)" and drops the button at the end', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });

    const group = groupFor(issuesRegion(), 'Código fuera de sincronía');
    const sdd002 = subgroupFor(group, 'SDD-002');
    expect(within(sdd002).getByRole('button', { name: /Mostrar 50 más \(quedan 30\)/ })).toBeTruthy();
    expect(within(subgroupFor(group, 'SDD-030')).queryByRole('button', { name: /Mostrar 50 más/ })).toBeNull();

    const sdd010 = subgroupFor(group, 'SDD-010');
    await userEvent.click(within(sdd010).getByRole('button', { name: /Mostrar 50 más \(quedan 50\)/ }));

    expect(sdd010.querySelectorAll('ul > li').length).toBe(100);
    expect(sdd010.querySelectorAll('ul > li').length).toBeLessThanOrEqual(100);
    expect(within(sdd010).queryByRole('button', { name: /Mostrar 50 más/ })).toBeNull();
  });

  it('turns the KPIs into severity filters without moving their counts', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });

    expect(kpiButton('errores').getAttribute('aria-pressed')).toBe('false');
    expect(kpiButton('avisos').getAttribute('aria-pressed')).toBe('false');
    expect(kpiButton('errores').textContent).toContain('226');
    expect(kpiButton('avisos').textContent).toContain('3');

    await userEvent.click(kpiButton('errores'));

    expect(kpiButton('errores').getAttribute('aria-pressed')).toBe('true');
    expect(kpiButton('avisos').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(triageSummary(226))).toBeTruthy();
    expect(issuesRegion().querySelectorAll('ul > li').length).toBe(146);
    expect(issuesRegion().textContent).not.toContain('Enlaces rotos');
    // The counts stay anchored to the full list, not to what the active filter shows.
    expect(kpiButton('avisos').textContent).toContain('3');

    // Clicking the active KPI turns the filter off again.
    await userEvent.click(kpiButton('errores'));
    expect(kpiButton('errores').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(triageSummary(TRIAGE_TOTAL))).toBeTruthy();
  });

  it('narrows the list by issue kind from the type chips', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });

    const tipo = screen.getByRole('radiogroup', { name: 'Tipo' });
    await userEvent.click(within(tipo).getByRole('radio', { name: /Enlaces rotos/ }));

    expect(within(tipo).getByRole('radio', { name: /Enlaces rotos/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(triageSummary(3))).toBeTruthy();
    expect(issuesRegion().querySelectorAll('ul > li').length).toBe(3);
    expect(groupFor(issuesRegion(), 'Enlaces rotos')).toBeTruthy();
    expect(issuesRegion().textContent).not.toContain('Código fuera de sincronía');
  });

  it('narrows the list by blueprint from the select', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Blueprint' }), 'SDD-010');

    expect(screen.getByText(triageSummary(100))).toBeTruthy();
    const region = issuesRegion();
    const group = groupFor(region, 'Código fuera de sincronía');
    const subgroups = Array.from(group.querySelectorAll<HTMLDetailsElement>(':scope > details'));
    expect(subgroups).toHaveLength(1);
    expect(subgroups[0]!.querySelectorAll('ul > li').length).toBe(50);
    // The unattributed bucket is filtered out with the rest of the blueprints.
    expect(region.textContent).not.toContain('Sin blueprint');
  });

  it('searches nodeId, target and featureIds case-insensitively', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });
    const search = screen.getByRole('searchbox', { name: 'Buscar en los issues' });

    await userEvent.type(search, 'FR-011'); // featureIds of one broken_link issue
    expect(screen.getByText(triageSummary(1))).toBeTruthy();

    await userEvent.clear(search);
    await userEvent.type(search, 'PRD-041.MD'); // target, in a different case
    expect(screen.getByText(triageSummary(1))).toBeTruthy();

    await userEvent.clear(search);
    await userEvent.type(search, 'adr-004'); // nodeId of the 6 unattributed issues
    expect(screen.getByText(triageSummary(6))).toBeTruthy();
  });

  it('combines severity, kind, blueprint and query as an intersection', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });

    await userEvent.click(kpiButton('errores'));
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Tipo' })).getByRole('radio', { name: /Código fuera de sincronía/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Blueprint' }), 'SDD-010');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar en los issues' }), 'core-77.ts');

    expect(screen.getByText(triageSummary(1))).toBeTruthy();
    expect(issuesRegion().querySelectorAll('ul > li').length).toBe(1);
    expect(issuesRegion().textContent).toContain('core-77.ts');
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeTruthy();
  });

  it('does not leave rows revealed by an earlier pagination after filtering', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });

    const group = groupFor(issuesRegion(), 'Código fuera de sincronía');
    const sdd010 = subgroupFor(group, 'SDD-010');
    await userEvent.click(within(sdd010).getByRole('button', { name: /Mostrar 50 más/ }));
    expect(sdd010.querySelectorAll('ul > li').length).toBe(100);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar en los issues' }), 'core-7.');

    expect(screen.getByText(triageSummary(1))).toBeTruthy();
    const filtered = subgroupFor(groupFor(issuesRegion(), 'Código fuera de sincronía'), 'SDD-010');
    expect(filtered.querySelectorAll('ul > li').length).toBe(1);
  });

  it('clears every filter back to the full list', async () => {
    renderDrift(TRIAGE_ISSUES);
    await screen.findByRole('region', { name: 'Issues de drift' });

    await userEvent.click(kpiButton('errores'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Blueprint' }), 'SDD-002');
    expect(screen.getByText(triageSummary(80))).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));

    expect(screen.getByText(triageSummary(TRIAGE_TOTAL))).toBeTruthy();
    expect(kpiButton('errores').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull();
    expect(groupFor(issuesRegion(), 'Código fuera de sincronía')).toBeTruthy();
    expect(groupFor(issuesRegion(), 'Enlaces rotos')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------
// SDD-069 / WO-634 — freshness of the official report: the relative age in the subtitle with the absolute
// instant in the tooltip, the stale-report warning, and the «Actualizar reporte» re-read action.
// ---------------------------------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_TITLE = 'Vuelve a leer el último reporte de CI; no dispara una corrida nueva.';

/** An official report created `days` complete days ago (plus a minute, so rounding lands exactly on `days`). */
function officialDaysAgo(days: number, overrides: Partial<DriftReportSummaryDto> = {}): DriftReportSummaryDto {
  return fakeReport({
    id: 'official-freshness',
    mode: 'baseline',
    tokenName: 'ci-pipeline',
    branch: 'main',
    createdAt: new Date(Date.now() - days * DAY_MS - 60_000).toISOString(),
    ...overrides,
  });
}

function renderOfficial(report: DriftReportSummaryDto): void {
  vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({ official: report, previews: [], history: [] });
  vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);
  renderPage();
}

describe('DriftDashboard · frescura del reporte oficial (SDD-069)', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('says the relative age in the subtitle and keeps the absolute instant in the tooltip', async () => {
    const report = officialDaysAgo(8);
    renderOfficial(report);

    const age = await screen.findByText('hace 8 d');
    const trigger = age.closest('[aria-describedby]');
    const tooltipId = trigger?.getAttribute('aria-describedby');
    expect(tooltipId).toBeTruthy();
    expect(document.getElementById(tooltipId!)?.textContent).toBe(formatDateTime(report.createdAt));
  });

  it('warns that a report a week or older may no longer reflect the code', async () => {
    renderOfficial(officialDaysAgo(8));

    const notice = await screen.findByText(/Los números pueden no reflejar el código actual/);
    expect(notice.textContent).toContain('El reporte oficial tiene 8 días');
    expect(notice.textContent).toContain(`se renueva cuando CI reporta un push sobre main.`);
  });

  it('does not warn for a report younger than the stale threshold', async () => {
    renderOfficial(officialDaysAgo(2));

    expect(await screen.findByText('hace 2 d')).toBeTruthy();
    expect(screen.queryByText(/Los números pueden no reflejar/)).toBeNull();
  });

  it('treats a report of exactly a week as stale: the threshold is inclusive', async () => {
    renderOfficial(officialDaysAgo(7));

    expect(await screen.findByText('hace 7 d')).toBeTruthy();
    expect(screen.getByText(/Los números pueden no reflejar/)).toBeTruthy();
  });

  it('re-reads the last official report without triggering a new CI run', async () => {
    const dashboardSpy = vi
      .spyOn(client, 'getDriftDashboard')
      .mockResolvedValue({ official: officialDaysAgo(3), previews: [], history: [] });
    const issuesSpy = vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);
    renderPage();
    await screen.findByText('hace 3 d');
    dashboardSpy.mockClear();
    issuesSpy.mockClear();

    const button = screen.getByRole('button', { name: REFRESH_TITLE });
    expect(button.getAttribute('title')).toBe(REFRESH_TITLE);
    expect(button.textContent).toContain('Actualizar reporte');

    await userEvent.click(button);

    await waitFor(() => expect(dashboardSpy).toHaveBeenCalled());
    expect(issuesSpy).toHaveBeenCalled();
    expect(await screen.findByText('Reporte releído')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------
// SDD-069 / WO-635 — the report sha: short on screen, copyable, and linked to the commit only when the
// project knows its own repository. A guessed URL would be a link that goes nowhere.
// ---------------------------------------------------------------------------------------------------

const COMMIT_SHA = 'd'.repeat(40);
const REPOSITORY = 'centurionhq/prdmanager';

function stubClipboard(impl: () => Promise<void>): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('DriftDashboard · sha del reporte (SDD-069 WO-635)', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('links the official report sha to its commit when the project has a repository', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({
      official: fakeReport({ mode: 'baseline', branch: 'main', headSha: COMMIT_SHA }),
      previews: [],
      history: [],
    });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);

    renderPage({ github_repository: REPOSITORY });

    const link = await screen.findByRole('link', { name: 'Ver el commit en GitHub' });
    expect(link.getAttribute('href')).toBe(`https://github.com/${REPOSITORY}/commit/${COMMIT_SHA}`);
    expect(screen.getByText(COMMIT_SHA.slice(0, 12))).toBeTruthy();
    expect(screen.getByRole('button', { name: `Copiar el sha ${COMMIT_SHA}` })).toBeTruthy();
  });

  it('renders no commit link at all without a repository, and still offers the copy', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({
      official: fakeReport({ mode: 'baseline', branch: 'main', headSha: COMMIT_SHA }),
      previews: [],
      history: [],
    });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(COMMIT_SHA.slice(0, 12))).toBeTruthy();
    expect(screen.queryAllByRole('link', { name: 'Ver el commit en GitHub' })).toHaveLength(0);
    expect(screen.getByRole('button', { name: `Copiar el sha ${COMMIT_SHA}` })).toBeTruthy();
  });

  it('copies a history row sha without opening the report detail', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue({
      official: null,
      previews: [],
      history: [fakeReport({ id: 'h1', mode: 'baseline', branch: 'main', headSha: COMMIT_SHA, tokenName: 'ci-pipeline' })],
    });
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);
    const detail = vi.spyOn(client, 'getDriftReportDetail').mockResolvedValue({
      id: 'h1',
      mode: 'baseline',
      headSha: COMMIT_SHA,
      branch: 'main',
      tokenName: 'ci-pipeline',
      issueCount: 0,
      hasBlockingIssues: false,
      createdAt: '2026-01-02T00:00:00.000Z',
      issues: [],
    });

    renderPage({ github_repository: REPOSITORY });
    await screen.findByRole('heading', { name: 'Historial' });

    await userEvent.click(screen.getByRole('button', { name: `Copiar el sha ${COMMIT_SHA}` }));

    expect(writeText).toHaveBeenCalledWith(COMMIT_SHA);
    expect(detail).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// SDD-070 / WO-638 — the "Previews por rama" panel is now the real `PreviewsByBranch` component (WO-637)
// mounted with the project's own shell data: `official`/`previews` for the delta, `default_branch` for the
// reference name and `github_repository` for the branch label. The panel and the history share one modal.
// ---------------------------------------------------------------------------------------------------

const PREVIEW_SHA = 'a1b2c3d4e5f6' + 'a'.repeat(28);

function previewDashboard(
  overrides: Partial<DriftDashboardDto> = {},
): DriftDashboardDto {
  return {
    official: fakeReport({ id: 'official-1', mode: 'baseline', branch: 'main', tokenName: 'ci-pipeline', issueCount: 226 }),
    previews: [
      fakeReport({ id: 'p1', branch: '32/merge', tokenName: 'ana-personal', issueCount: 380, headSha: PREVIEW_SHA }),
      fakeReport({ id: 'p2', branch: 'feat/mejora', tokenName: 'bob-personal', issueCount: 142, headSha: 'c'.repeat(40) }),
    ],
    history: [],
    ...overrides,
  };
}

describe('DriftDashboard · previews por rama montadas (SDD-070 WO-638)', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('mounts the panel with the official report, the previews, the default branch and the repository', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue(previewDashboard());
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);

    renderPage({ default_branch: 'trunk', github_repository: REPOSITORY });

    // `32/merge` reads as `PR #32` and the delta is named after the project's own default branch, never a
    // literal "main" (the shell really carries `default_branch: 'trunk'` here).
    const row = await screen.findByRole('button', { name: 'Ver los 380 issues del reporte de PR #32' });
    expect(row.tagName).toBe('BUTTON');
    expect(screen.getByText('PR #32')).toBeTruthy();
    expect(screen.getByText('+154 vs trunk')).toBeTruthy();
    expect(screen.getByText('-84 vs trunk')).toBeTruthy();
    expect(screen.queryByText('+154 vs main')).toBeNull();
  });

  it('opens the right report detail from a preview row, through the same modal as a history row', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue(
      previewDashboard({ history: [fakeReport({ id: 'h1', mode: 'baseline', branch: 'main', tokenName: 'ci-pipeline' })] }),
    );
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);
    const detail = vi.spyOn(client, 'getDriftReportDetail').mockResolvedValue({
      id: 'p1',
      mode: 'preview',
      headSha: PREVIEW_SHA,
      branch: '32/merge',
      tokenName: 'ana-personal',
      issueCount: 380,
      hasBlockingIssues: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      issues: [fakeIssue()],
    });

    renderPage({ github_repository: REPOSITORY });
    await userEvent.click(await screen.findByRole('button', { name: 'Ver los 380 issues del reporte de PR #32' }));

    expect(detail).toHaveBeenCalledWith('acme', 'web', 'p1');
    const dialog = await screen.findByRole('dialog', { name: 'Detalle del reporte' });
    const meta = await within(dialog).findByText(/ana-personal/);
    expect(meta.textContent).toBe('PR #32 · a1b2c3d4e5f6 · ana-personal · 380 issues');
    expect(within(dialog).getByRole('link', { name: 'PR #32' }).getAttribute('href')).toBe(
      `https://github.com/${REPOSITORY}/pull/32`,
    );
  });

  it('shows no numeric delta for any preview when there is no official report', async () => {
    vi.spyOn(client, 'getDriftDashboard').mockResolvedValue(previewDashboard({ official: null }));
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([]);

    renderPage({ default_branch: 'trunk' });

    const unknowns = await screen.findAllByText('— vs trunk');
    expect(unknowns).toHaveLength(2);
    expect(screen.queryByText(/^\+\d+ vs trunk$/)).toBeNull();
    expect(screen.queryByText(/^-\d+ vs trunk$/)).toBeNull();
    expect(screen.queryByText('0 vs trunk')).toBeNull();
  });
});
