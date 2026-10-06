import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Metrics } from '../../../src/data';
import { PlantaKpiStrip } from '../../../src/features/planta/PlantaKpiStrip';
import { buildKpis } from '../../../src/features/planta/planta-overview-data';

/**
 * WO-648: the band grew from 4 to 5 KPIs. `commitsWithRefs` and `commitsTraced` are deliberately
 * different here, so wiring either commit cell to the wrong field (the shipped bug was "Commits con
 * Refs" ← `commitPercent`) fails this test instead of passing by coincidence of equal numbers.
 * WO-669: the commit KPIs show n/total and open a drawer with the untraced list.
 */
const METRICS_FIXTURE: Metrics = {
  agentHumanEfficiency: { completedWorkOrders: 10, measuredWorkOrders: 10, avgResolutionHours: 0.1, medianResolutionHours: 0.083, unmeasured: { total: 0, workOrders: [] } },
  systemIntegrity: { governedTotal: 100, governedSynced: 99, syncedPercent: 99.6 },
  traceability: {
    featuresTotal: 4,
    featuresTraced: 4,
    featurePercent: 100,
    commitsTotal: 20,
    commitsWithRefs: 10,
    commitsTraced: 6,
    commitPercent: 30,
    untracedCommits: {
      total: 14,
      danglingRefs: 4,
      truncated: false,
      items: [
        { sha: 'aaaaaaa1111', subject: 'sin trailer', author: 'Ana', date: '2026-09-27T18:21:00.000Z', files: ['a.ts', 'b.ts'], gap: 'no_refs' },
        { sha: 'bbbbbbb2222', subject: 'ref que no resuelve', author: 'Beto', date: '2026-09-27T18:22:00.000Z', files: ['c.ts'], gap: 'dangling_refs' },
      ],
    },
  },
};

/** Product order (D1), left→right; the two commit KPIs stay adjacent, "Commits con Refs" last. */
const EXPECTED_LABELS = ['Resolución mediana de una orden', 'Código sincronizado', 'Features trazadas', 'Commits trazados', 'Commits con Refs'];

describe('PlantaKpiStrip', () => {
  it('builds the 5 KPIs in product order, each from its own field', () => {
    const kpis = buildKpis(METRICS_FIXTURE);

    expect(kpis.map((kpi) => [kpi.label, kpi.value])).toEqual([
      ['Resolución mediana de una orden', '5 min'],
      ['Código sincronizado', '99,6 %'],
      ['Features trazadas', '100 %'],
      ['Commits trazados', '6/20'], // commitsTraced / commitsTotal
      ['Commits con Refs', '10/20'], // commitsWithRefs / commitsTotal
    ]);
    expect(kpis[3]!.percent).toBe('30 %'); // commitPercent
    expect(kpis[4]!.percent).toBe('50 %'); // commitsWithRefs / commitsTotal = 10/20
    expect(kpis[3]!.detail).toMatchObject({ kind: 'traced', count: '14 de 20 commits sin trazar', dangling: '4 refs colgantes', truncatedCopy: null });
    expect(kpis[3]!.detail!.rows).toHaveLength(2);
    expect(kpis[4]!.detail).toMatchObject({ kind: 'with_refs', count: '10 de 20 commits sin el trailer Refs:', dangling: null });
    expect(kpis[4]!.detail!.rows.map((row) => row.sha)).toEqual(['aaaaaaa']);
  });

  it('renders the 5 cells in order, with "Commits con Refs" as the closing cell', () => {
    render(<PlantaKpiStrip />);

    const strip = screen.getByRole('region', { name: 'Indicadores de la planta' });
    const labels = [...strip.querySelectorAll(':scope > div > span:first-child')].map((node) => node.textContent);
    expect(labels).toEqual(EXPECTED_LABELS);
    expect(strip.children).toHaveLength(5);
  });

  it('shows "Sin datos" for "Commits con Refs" when there are no commits, with no control', () => {
    const kpis = buildKpis({ ...METRICS_FIXTURE, traceability: { ...METRICS_FIXTURE.traceability, commitsTotal: 0, commitsWithRefs: 0, commitsTraced: 0 } });

    expect(kpis[4]).toEqual({ label: 'Commits con Refs', value: 'Sin datos' });
  });

  it('makes the commit KPI a button that opens a dialog with the definition and the table', async () => {
    render(<PlantaKpiStrip />);

    const button = screen.getByRole('button', { name: 'Commits trazados: 166/250' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeTruthy();
    await userEvent.click(button);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/^Commits cuya ref resuelve la cadena/)).toBeTruthy();
    expect(within(dialog).getAllByRole('columnheader')).toHaveLength(5);
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
  });

  it('marks the dangling row with text in "Commits trazados" and leaves it out of "Commits con Refs"', async () => {
    render(<PlantaKpiStrip />);

    await userEvent.click(screen.getByRole('button', { name: 'Commits trazados: 166/250' }));
    const traced = await screen.findByRole('dialog');
    expect(within(traced.querySelector('tbody tr:last-child') as HTMLElement).getByText('ref colgante')).toBeTruthy();
    expect(within(traced).getAllByText('ref colgante')).toHaveLength(1);
    act(() => {
      traced.dispatchEvent(new Event('cancel', { cancelable: true }));
    });

    await userEvent.click(screen.getByRole('button', { name: 'Commits con Refs: 172/250' }));
    const withRefs = await screen.findByRole('dialog');
    expect(within(withRefs).queryByText('ref colgante')).toBeNull();
    expect(within(withRefs).getByText('Se muestran los primeros 4 de 84.')).toBeTruthy();
  });

  it('shows the scoped error with its own retry, and never the page copy (SDD-085 D2)', async () => {
    let retries = 0;
    render(<PlantaKpiStrip estado="error" onRetry={() => (retries += 1)} />);

    const strip = screen.getByRole('region', { name: 'Indicadores de la planta' });
    expect(within(strip).getByText('No pudimos cargar los indicadores')).toBeTruthy();
    expect(screen.queryByText(/no pudimos cargar la planta/i)).toBeNull();
    await userEvent.click(within(strip).getByRole('button', { name: 'Reintentar' }));
    expect(retries).toBe(1);
  });

  it('collapses into one line with a link to connect while awaiting the first report (SDD-085 D3)', () => {
    render(<PlantaKpiStrip estado="primer_reporte" />);

    expect(screen.getAllByText('Todavía no hay reporte de CI: los indicadores llegan con el primero')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Conectar mi entorno' })).toBeTruthy();
    for (const label of EXPECTED_LABELS) expect(screen.queryByText(label)).toBeNull();
  });

  it('draws five skeleton cells while loading, with no labels or values', () => {
    render(<PlantaKpiStrip estado="cargando" />);

    const strip = screen.getByRole('region', { name: 'Indicadores de la planta' });
    expect(strip.children).toHaveLength(5);
    expect(strip.textContent).toBe('');
  });

  it('says how many orders have no measurement, with a closed details listing one row each (WO-672)', async () => {
    render(<PlantaKpiStrip />);

    expect(screen.getByText('4 de 486 órdenes sin medición')).toBeTruthy();
    const summary = screen.getByText('Ver las 4 órdenes');
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    await userEvent.click(summary);
    const list = within(details).getByRole('list', { name: 'Órdenes sin medición' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    for (const copy of ['sin fecha de reclamo', 'sin fecha de cierre', 'fecha inválida', 'cierre anterior al reclamo']) {
      expect(within(list).getByText(copy)).toBeTruthy();
    }
    expect(within(list).getAllByText('reclamo — · cierre —')).toHaveLength(2);
  });

  it('adds no note when nothing is unmeasured or the field is missing', () => {
    expect(buildKpis({ ...METRICS_FIXTURE })[0]!.note).toBeUndefined();
    const { unmeasured: _omitted, ...legacy } = METRICS_FIXTURE.agentHumanEfficiency;
    expect(buildKpis({ ...METRICS_FIXTURE, agentHumanEfficiency: legacy as Metrics['agentHumanEfficiency'] })[0]!.note).toBeUndefined();
  });
});
