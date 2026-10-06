import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Metrics } from '../../../src/data';
import { PlantaKpiStrip } from '../../../src/features/planta/PlantaKpiStrip';
import { buildKpis } from '../../../src/features/planta/planta-overview-data';

/**
 * WO-648: the band grew from 4 to 5 KPIs. `commitsWithRefs` and `commitsTraced` are deliberately
 * different here, so wiring either commit cell to the wrong field (the shipped bug was "Commits con
 * Refs" ← `commitPercent`) fails this test instead of passing by coincidence of equal numbers.
 */
const METRICS_FIXTURE: Metrics = {
  agentHumanEfficiency: { completedWorkOrders: 10, measuredWorkOrders: 10, avgResolutionHours: 0.1, medianResolutionHours: 0.083 },
  systemIntegrity: { governedTotal: 100, governedSynced: 99, syncedPercent: 99.6 },
  traceability: { featuresTotal: 4, featuresTraced: 4, featurePercent: 100, commitsTotal: 20, commitsWithRefs: 10, commitsTraced: 6, commitPercent: 30 },
};

/** Product order (D1), left→right; the two commit KPIs stay adjacent, "Commits con Refs" last. */
const EXPECTED_LABELS = ['Resolución mediana de una orden', 'Código sincronizado', 'Features trazadas', 'Commits trazados', 'Commits con Refs'];

describe('PlantaKpiStrip', () => {
  it('builds the 5 KPIs in product order, each from its own field', () => {
    expect(buildKpis(METRICS_FIXTURE)).toEqual([
      { label: 'Resolución mediana de una orden', value: '5 min' },
      { label: 'Código sincronizado', value: '99,6 %' },
      { label: 'Features trazadas', value: '100 %' },
      { label: 'Commits trazados', value: '30 %' }, // commitPercent
      { label: 'Commits con Refs', value: '50 %' }, // commitsWithRefs / commitsTotal = 10/20
    ]);
  });

  it('renders the 5 cells in order, with "Commits con Refs" as the closing cell', () => {
    render(<PlantaKpiStrip />);

    const strip = screen.getByRole('region', { name: 'Indicadores de la planta' });
    const labels = [...strip.querySelectorAll('span:nth-child(1)')].map((node) => node.textContent);
    expect(labels).toEqual(EXPECTED_LABELS);
    expect(strip.children).toHaveLength(5);
  });

  it('shows "Sin datos" for "Commits con Refs" when there are no commits', () => {
    const kpis = buildKpis({ ...METRICS_FIXTURE, traceability: { ...METRICS_FIXTURE.traceability, commitsTotal: 0, commitsWithRefs: 0, commitsTraced: 0 } });

    expect(kpis[4]).toEqual({ label: 'Commits con Refs', value: 'Sin datos' });
  });
});
