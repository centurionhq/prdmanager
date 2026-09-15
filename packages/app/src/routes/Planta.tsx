/**
 * `/o/:orgSlug/p/:projectSlug` index route (Centurion Factory "Planta", SDD-012, WO-354): the six-station
 * line board (`getLineBoard`) plus the success-metrics KPI strip (`getMetrics`). Replaces
 * `PlantaPlaceholder`. See canvas/Main.dc.html — the sidebar itself is `ProjectShell`'s own `AppShell`,
 * unchanged by this WO; this route only renders the dark line band and the KPI strip below it.
 */
import { type CSSProperties, type ReactElement } from 'react';
import { Link } from 'react-router';
import { STATIONS, type FeatureLineDto, type LineBoardDto, type Station, type SuccessMetricsDto } from '@prdm/contracts';
import { getLineBoard, getMetrics } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';

const STATION_LABELS: Record<Station, string> = {
  ingesta: 'Ingesta',
  definicion: 'Definición',
  diseno: 'Diseño',
  planificacion: 'Planificación',
  ejecucion: 'Ejecución',
  cierre: 'Cierre',
};

const PERCENT_FORMATTER = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

function formatPercent(value: number | null): string {
  return value === null ? 'Sin datos' : `${PERCENT_FORMATTER.format(value)} %`;
}

function formatMedianResolution(hours: number | null): string {
  return hours === null ? 'Sin datos' : `${Math.round(hours * 60)} min`;
}

function stationIndex(station: Station): number {
  return STATIONS.indexOf(station);
}

function rowLabel(feature: FeatureLineDto): string {
  const { progress } = feature;
  if (progress.total === 0) return 'Sin órdenes activas';
  const base = `${progress.done}/${progress.total}`;
  return progress.stopped > 0 ? `${base} · ${progress.stopped} ${progress.stopped === 1 ? 'parada' : 'paradas'}` : base;
}

interface LineBoardBandProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly lineBoard: LineBoardDto;
}

function StationCell({
  orgSlug,
  projectSlug,
  feature,
  station,
  cellIndex,
  isAndonColumn,
  isAndonFeature,
}: {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly feature: FeatureLineDto;
  readonly station: Station;
  readonly cellIndex: number;
  readonly isAndonColumn: boolean;
  readonly isAndonFeature: boolean;
}): ReactElement {
  const ownIndex = stationIndex(feature.station);
  const cellStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 12,
    background: isAndonColumn ? 'var(--linea-tinte-andon)' : undefined,
  };

  if (cellIndex < ownIndex) {
    return (
      <span key={station} style={cellStyle}>
        <span aria-hidden="true" style={{ flex: 1, height: 2, background: 'var(--linea-hecho)' }} />
      </span>
    );
  }

  if (cellIndex > ownIndex) {
    return <span key={station} style={cellStyle} />;
  }

  const markerColor = isAndonFeature ? 'var(--andon)' : feature.progress.done === feature.progress.total && feature.progress.total > 0 ? 'var(--linea-hecho)' : 'var(--linea-texto)';
  const content = (
    <>
      <span aria-hidden="true" style={{ flex: 'none', width: 14, height: 14, background: markerColor }} />
      <span className="num" style={{ fontSize: 13, color: isAndonFeature ? 'var(--andon)' : 'var(--linea-texto)', fontWeight: isAndonFeature ? 600 : 400 }}>
        {rowLabel(feature)}
      </span>
    </>
  );

  if (isAndonFeature) {
    return (
      <Link
        key={station}
        to={`/o/${orgSlug}/p/${projectSlug}/drift?feature=${encodeURIComponent(feature.id)}`}
        style={{ ...cellStyle, textDecoration: 'none' }}
        aria-label={`${feature.id} ${feature.title}, línea detenida en ${STATION_LABELS[station]}: ${rowLabel(feature)}. Ver drift.`}
      >
        {content}
      </Link>
    );
  }

  return (
    <span key={station} style={cellStyle}>
      {content}
    </span>
  );
}

function LineBoardBand({ orgSlug, projectSlug, lineBoard }: LineBoardBandProps): ReactElement {
  const andon = lineBoard.andon;
  const andonStationIndex = andon ? stationIndex(andon.station) : -1;

  return (
    <section
      aria-label="La línea"
      style={{ background: 'var(--grafito)', color: 'var(--acero)', margin: '0 -32px', padding: '24px 32px 28px' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>La línea</h2>
        {andon ? (
          <p style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--linea-texto)', margin: 0 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--andon)' }} />
            Línea detenida en {STATION_LABELS[andon.station]}
          </p>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `280px repeat(${STATIONS.length}, minmax(0, 1fr))` }} aria-hidden="true">
        <span style={{ fontSize: 13, color: 'var(--linea-apagado)', paddingBottom: 10 }}>Feature</span>
        {STATIONS.map((station, index) => (
          <span
            key={station}
            style={{
              fontSize: 13,
              fontWeight: index === andonStationIndex ? 700 : 400,
              color: index === andonStationIndex ? 'var(--grafito)' : 'var(--linea-texto)',
              background: index === andonStationIndex ? 'var(--andon)' : undefined,
              padding: '0 0 10px 12px',
              borderLeft: index === andonStationIndex ? undefined : '1px solid var(--linea-regla)',
            }}
          >
            {STATION_LABELS[station]}
          </span>
        ))}
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
        {lineBoard.features.map((feature) => {
          const isAndonFeature = andon?.featureId === feature.id;
          return (
            <li
              key={feature.id}
              style={{
                display: 'grid',
                gridTemplateColumns: `280px repeat(${STATIONS.length}, minmax(0, 1fr))`,
                height: 48,
                alignItems: 'center',
                borderTop: '1px solid var(--linea-regla)',
              }}
            >
              <Link
                to={`/o/${orgSlug}/p/${projectSlug}/arbol/${feature.id}`}
                style={{ display: 'flex', gap: 10, alignItems: 'baseline', minWidth: 0, color: 'inherit', textDecoration: 'none' }}
                aria-label={`${feature.id} ${feature.title}, estación ${STATION_LABELS[feature.station]}`}
              >
                <span className="id" style={{ flex: 'none', color: 'var(--linea-apagado)' }}>
                  {feature.id}
                </span>
                <span style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{feature.title}</span>
              </Link>
              {STATIONS.map((station, cellIndex) => (
                <StationCell
                  key={station}
                  orgSlug={orgSlug}
                  projectSlug={projectSlug}
                  feature={feature}
                  station={station}
                  cellIndex={cellIndex}
                  isAndonColumn={cellIndex === andonStationIndex}
                  isAndonFeature={isAndonFeature && cellIndex === stationIndex(feature.station)}
                />
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
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
    <section
      aria-label="Indicadores de la planta"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', borderTop: '1px solid var(--regla)', borderBottom: '1px solid var(--regla)' }}
    >
      {items.map((item) => (
        <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 24px' }}>
          <span style={{ fontSize: 14, color: 'var(--apagado)' }}>{item.label}</span>
          {awaitingFirstReport ? (
            <span style={{ fontSize: 14, color: 'var(--apagado)' }}>Esperando el primer reporte de CI</span>
          ) : (
            <span className="num" style={{ fontSize: 36, fontWeight: 700 }}>
              {item.value}
            </span>
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

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Skeleton rows={6} />
          <Skeleton rows={1} columns={4} />
        </div>
      ) : null}

      {!isLoading && failure ? (
        <ErrorState title="No pudimos cargar la planta" body={errorMessage(failure.error)} onRetry={failure.retry} />
      ) : null}

      {!isLoading && !failure && lineBoardQuery.status === 'vacio' ? <EmptyState title="Todavía no hay features en la línea" /> : null}

      {!isLoading && !failure && lineBoardQuery.data && metricsQuery.data && lineBoardQuery.status !== 'vacio' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <LineBoardBand orgSlug={orgSlug} projectSlug={projectSlug} lineBoard={lineBoardQuery.data} />
          <KpiStrip metrics={metricsQuery.data} awaitingFirstReport={project.awaitingFirstReport} />
        </div>
      ) : null}
    </div>
  );
}
