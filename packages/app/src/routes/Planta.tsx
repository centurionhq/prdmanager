/**
 * `/o/:orgSlug/p/:projectSlug` index route (Centurion Factory "Planta", originally SDD-012, WO-354;
 * rebuilt on the design system with the seven-station line and BC/PRD row nesting by SDD-024/PRD-011,
 * WO-445): the line board (`getLineBoard`, now `LineBoard` — see `../components/LineBoard/LineBoard.tsx`)
 * plus the success-metrics KPI strip (`getMetrics`). See canvas/Main.dc.html — the sidebar itself is
 * `ProjectShell`'s own `AppShell`, unchanged by this WO; this route only renders the line and the strip.
 */
import { type ReactElement } from 'react';
import type { SuccessMetricsDto } from '@prdm/contracts';
import { getLineBoard, getMetrics } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import { EmptyState, ErrorState, LineBoard, PageHeader, Skeleton } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import styles from './Planta.module.css';
import { useProjectShellContext } from './ProjectShell.js';

const PERCENT_FORMATTER = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

function formatPercent(value: number | null): string {
  return value === null ? 'Sin datos' : `${PERCENT_FORMATTER.format(value)} %`;
}

function formatMedianResolution(hours: number | null): string {
  return hours === null ? 'Sin datos' : `${Math.round(hours * 60)} min`;
}

interface KpiStripProps {
  readonly metrics: SuccessMetricsDto;
  readonly awaitingFirstReport: boolean;
}

function KpiStrip({ metrics, awaitingFirstReport }: KpiStripProps): ReactElement {
  const items = [
    { label: 'Resolución mediana de una orden', value: formatMedianResolution(metrics.agentHumanEfficiency.medianResolutionHours) },
    { label: 'Código sincronizado', value: formatPercent(metrics.systemIntegrity.syncedPercent) },
    { label: 'Features trazadas', value: formatPercent(metrics.traceability.featurePercent) },
    { label: 'Commits con Refs', value: formatPercent(metrics.traceability.commitPercent) },
  ];

  return (
    <section aria-label="Indicadores de la planta" className={styles.kpiStrip}>
      {items.map((item) => (
        <div key={item.label} className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{item.label}</span>
          {awaitingFirstReport ? <span className={styles.kpiLabel}>Esperando el primer reporte de CI</span> : <span className={`num ${styles.kpiValue}`}>{item.value}</span>}
        </div>
      ))}
    </section>
  );
}

export function Planta(): ReactElement {
  const { orgSlug, projectSlug, project } = useProjectShellContext();
  useDocumentTitle('Planta');

  const lineBoardQuery = useApiQuery(
    `line-board:${orgSlug}:${projectSlug}`,
    () => getLineBoard(orgSlug, projectSlug),
    [orgSlug, projectSlug],
    (data) => data.features.length === 0,
  );
  const metricsQuery = useApiQuery(`metrics:${orgSlug}:${projectSlug}`, () => getMetrics(orgSlug, projectSlug), [orgSlug, projectSlug], () => false);

  const isLoading = lineBoardQuery.status === 'cargando' || metricsQuery.status === 'cargando';
  const failure = lineBoardQuery.status === 'error' ? lineBoardQuery : metricsQuery.status === 'error' ? metricsQuery : null;

  return (
    <div>
      <PageHeader title="Planta" />

      {isLoading ? (
        <div className={styles.loading}>
          <Skeleton rows={6} />
          <Skeleton rows={1} columns={4} />
        </div>
      ) : null}

      {!isLoading && failure ? <ErrorState title="No pudimos cargar la planta" body={errorMessage(failure.error)} onRetry={failure.retry} /> : null}

      {!isLoading && !failure && lineBoardQuery.status === 'vacio' ? <EmptyState title="Todavía no hay features en la línea" /> : null}

      {!isLoading && !failure && lineBoardQuery.data && metricsQuery.data && lineBoardQuery.status !== 'vacio' ? (
        <div className={styles.page}>
          <LineBoard orgSlug={orgSlug} projectSlug={projectSlug} lineBoard={lineBoardQuery.data} />
          <KpiStrip metrics={metricsQuery.data} awaitingFirstReport={project.awaitingFirstReport} />
        </div>
      ) : null}
    </div>
  );
}
