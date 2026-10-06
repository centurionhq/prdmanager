/**
 * `/o/:orgSlug/p/:projectSlug` index route (Centurion Factory "Planta", originally SDD-012, WO-354;
 * rebuilt on the design system with the seven-station line and BC/PRD row nesting by SDD-024/PRD-011,
 * WO-445): the line board (`getLineBoard`, now `LineBoard` — see `../components/LineBoard/LineBoard.tsx`)
 * plus the success-metrics KPI strip (`getMetrics`). See canvas/Main.dc.html — the sidebar itself is
 * `ProjectShell`'s own `AppShell`, unchanged by this WO; this route only renders the line and the strip.
 */
import { type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { SuccessMetricsDto } from '@prdm/contracts';
import { getLineBoard, getMetrics } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import { EmptyState, ErrorState, LineBoard, PageHeader, Skeleton } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { ProfileBand } from './inicio/ProfileBand.js';
import styles from './Planta.module.css';
import { useProjectShellContext } from './ProjectShell.js';

const PERCENT_FORMATTER = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

function formatPercent(value: number | null): string {
  return value === null ? 'Sin datos' : `${PERCENT_FORMATTER.format(value)} %`;
}

function formatMedianResolution(hours: number | null): string {
  return hours === null ? 'Sin datos' : `${Math.round(hours * 60)} min`;
}

/** Mirrors core's `percent()`: no commits means "no data", not a fabricated 0 %. */
function formatCommitRefsPercent(traceability: SuccessMetricsDto['traceability']): string {
  return formatPercent(traceability.commitsTotal === 0 ? null : (traceability.commitsWithRefs / traceability.commitsTotal) * 100);
}

interface KpiStripProps {
  readonly metrics: SuccessMetricsDto;
  readonly awaitingFirstReport: boolean;
  readonly orgSlug: string;
  readonly projectSlug: string;
}

function KpiStrip({ metrics, awaitingFirstReport, orgSlug, projectSlug }: KpiStripProps): ReactElement {
  const { featuresTotal, featuresTraced, orphanFeatures } = metrics.traceability;
  // SDD-079 D4: la invariante del servidor es featuresTraced + orphanFeatures.length === featuresTotal.
  // El faltante es la MISMA lista que filtra el Árbol, así que el número de acá y el del chip coinciden.
  const missing = orphanFeatures.length;
  const ratio = `${featuresTraced}/${featuresTotal}`;
  const treeHref = `/o/${orgSlug}/p/${projectSlug}/arbol?sinCodigo=1`;

  const traced: { readonly value: ReactNode; readonly note: ReactNode } =
    featuresTotal === 0
      ? { value: <span className={`num ${styles.kpiValue}`}>Sin datos</span>, note: null }
      : missing === 0
        ? { value: <span className={`num ${styles.kpiValue}`}>{ratio}</span>, note: <span className={styles.kpiLabel}>Todas trazadas</span> }
        : {
            value: (
              <Link className={`num ${styles.kpiValue}`} to={treeHref} aria-label={`${featuresTraced} de ${featuresTotal} features trazadas; faltan ${missing}`}>
                {ratio}
              </Link>
            ),
            note: <span className={styles.kpiLabel}>faltan {missing}</span>,
          };

  const plain = (value: string): ReactNode => <span className={`num ${styles.kpiValue}`}>{value}</span>;
  const items: { label: string; value: ReactNode; note: ReactNode }[] = [
    { label: 'Resolución mediana de una orden', value: plain(formatMedianResolution(metrics.agentHumanEfficiency.medianResolutionHours)), note: null },
    { label: 'Código sincronizado', value: plain(formatPercent(metrics.systemIntegrity.syncedPercent)), note: null },
    { label: 'Features trazadas', value: traced.value, note: traced.note },
    { label: 'Commits trazados', value: plain(formatPercent(metrics.traceability.commitPercent)), note: null },
    { label: 'Commits con Refs', value: plain(formatCommitRefsPercent(metrics.traceability)), note: null },
  ];

  return (
    <section aria-label="Indicadores de la planta" className={styles.kpiStrip}>
      {items.map((item) => (
        <div key={item.label} className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{item.label}</span>
          {awaitingFirstReport ? (
            <span className={styles.kpiLabel}>Esperando el primer reporte de CI</span>
          ) : (
            <>
              {item.value}
              {item.note}
            </>
          )}
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

      {/* SDD-051: the entry band depends only on the shell's context, never on the line's data, so it is
          always there -- including while the line loads, if it fails, and above the empty state, which is
          exactly when someone most needs to be told where to start. */}
      <ProfileBand />

      {isLoading ? (
        <div className={styles.loading}>
          <Skeleton rows={6} />
          <Skeleton rows={1} columns={5} />
        </div>
      ) : null}

      {!isLoading && failure ? <ErrorState title="No pudimos cargar la planta" body={errorMessage(failure.error)} onRetry={failure.retry} /> : null}

      {!isLoading && !failure && lineBoardQuery.status === 'vacio' ? <EmptyState title="Todavía no hay features en la línea" /> : null}

      {!isLoading && !failure && lineBoardQuery.data && metricsQuery.data && lineBoardQuery.status !== 'vacio' ? (
        <div className={styles.page}>
          <LineBoard orgSlug={orgSlug} projectSlug={projectSlug} lineBoard={lineBoardQuery.data} />
          <KpiStrip metrics={metricsQuery.data} awaitingFirstReport={project.awaitingFirstReport} orgSlug={orgSlug} projectSlug={projectSlug} />
        </div>
      ) : null}
    </div>
  );
}
