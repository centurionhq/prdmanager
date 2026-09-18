/**
 * "La línea" — the Centurion Factory line board's seven-station band (originally SDD-012 "Centurion
 * Factory conectado al backend SaaS", WO-354; rebuilt as a design-system component and expanded to seven
 * stations plus BC/PRD row nesting by SDD-024/PRD-011 §4.3-§4.5, WO-445). Approved canvas:
 * `design/centurion-factory/canvas/Main.dc.html` (desktop) / `PlantaMobile.dc.html` (375px) — both render
 * the same DOM, toggled by `LineBoard.module.css`'s `@media (max-width: 767px)` rather than two branches
 * of JSX, the same convention `DataTable` already uses for its own mobile stack.
 */
import { type ReactElement } from 'react';
import { Link } from 'react-router';
import { STATIONS, type FeatureLineDto, type LineBoardDto, type Station } from '@prdm/contracts';
import styles from './LineBoard.module.css';

interface StationMeta {
  readonly label: string;
  readonly help: string;
  readonly pillar: 'Negocio' | 'Producto' | 'Tecnología' | null;
}

const STATION_META: Record<Station, StationMeta> = {
  entrada: { label: 'Entrada', help: 'Llegó sin evaluar', pillar: null },
  caso_negocio: { label: 'Caso de negocio', help: '¿Por qué conviene?', pillar: 'Negocio' },
  producto: { label: 'Producto', help: '¿Qué construimos?', pillar: 'Producto' },
  diseno_tecnico: { label: 'Diseño técnico', help: '¿Cómo lo hacemos?', pillar: 'Tecnología' },
  planificacion: { label: 'Planificación', help: 'Sin arrancar', pillar: 'Tecnología' },
  construccion: { label: 'Construcción', help: 'En curso', pillar: 'Tecnología' },
  entregado: { label: 'Entregado', help: 'Cerrado', pillar: null },
};

function stationIndex(station: Station): number {
  return STATIONS.indexOf(station);
}

function rowLabel(feature: FeatureLineDto): string {
  const { progress } = feature;
  if (progress.total === 0) return 'Sin órdenes activas';
  const base = `${progress.done}/${progress.total}`;
  return progress.stopped > 0 ? `${base} · ${progress.stopped} ${progress.stopped === 1 ? 'parada' : 'paradas'}` : base;
}

interface SecondaryLine {
  readonly text: string;
  readonly mono: boolean;
}

/** WO-445/SDD-024 §4.4: a BC row names its linked PRD(s) (or says it has none yet); a legacy top-level
 * PRD (WO-443's collapsing already filtered out any BC-linked one) names its missing BC. MRD/FR carry no
 * secondary line, same as before this WO. */
function secondaryLine(feature: FeatureLineDto): SecondaryLine | null {
  if (feature.kind === 'BC') {
    return feature.children.length === 0
      ? { text: 'sin PRD/FR todavía', mono: false }
      : { text: feature.children.map((child) => child.id).join(' · '), mono: true };
  }
  // WO-451/SDD-025: FR needs an approved BC just like PRD does (WO-448's gate), so a legacy top-level FR
  // (WO-450 already collapsed any BC-linked one into its BC's row) gets the same annotation as a PRD.
  if (feature.kind === 'PRD' || feature.kind === 'FR') return { text: 'sin caso de negocio', mono: false };
  return null;
}

interface StationCellProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly feature: FeatureLineDto;
  readonly station: Station;
  readonly cellIndex: number;
  readonly isAndonColumn: boolean;
  readonly isAndonFeature: boolean;
}

function StationCell({ orgSlug, projectSlug, feature, station, cellIndex, isAndonColumn, isAndonFeature }: StationCellProps): ReactElement {
  const ownIndex = stationIndex(feature.station);
  const cellClassName = isAndonColumn ? `${styles.cell} ${styles.cellAndonTint}` : styles.cell;

  if (cellIndex < ownIndex) {
    return (
      <span key={station} className={cellClassName}>
        <span aria-hidden="true" className={styles.cellRail} />
      </span>
    );
  }

  if (cellIndex > ownIndex) {
    return <span key={station} className={cellClassName} />;
  }

  const done = feature.progress.done === feature.progress.total && feature.progress.total > 0;
  const markerClassName = [styles.cellMarker, isAndonFeature ? styles.cellMarkerAndon : done ? styles.cellMarkerDone : null].filter(Boolean).join(' ');
  const textClassName = isAndonFeature ? `${styles.cellText} ${styles.cellTextAndon}` : styles.cellText;
  const content = (
    <>
      <span aria-hidden="true" className={markerClassName} />
      <span className={`num ${textClassName}`}>{rowLabel(feature)}</span>
    </>
  );

  if (isAndonFeature) {
    return (
      <Link
        key={station}
        to={`/o/${orgSlug}/p/${projectSlug}/drift?feature=${encodeURIComponent(feature.id)}`}
        className={`${cellClassName} ${styles.cellLink}`}
        aria-label={`${feature.id} ${feature.title}, línea detenida en ${STATION_META[station].label}: ${rowLabel(feature)}. Ver drift.`}
      >
        {content}
      </Link>
    );
  }

  return (
    <span key={station} className={cellClassName}>
      {content}
    </span>
  );
}

interface MobileStationProps {
  readonly feature: FeatureLineDto;
  readonly isAndonFeature: boolean;
}

/** The 375px layout's left column (`PlantaMobile.dc.html`): current station + pillar, replacing the
 * desktop rail's seven cells — CSS-only toggle, see this component's own doc comment. */
function MobileStation({ feature, isAndonFeature }: MobileStationProps): ReactElement {
  const meta = STATION_META[feature.station];
  const done = feature.progress.done === feature.progress.total && feature.progress.total > 0;
  const markerClassName = [styles.cellMarker, isAndonFeature ? styles.cellMarkerAndon : done ? styles.cellMarkerDone : null].filter(Boolean).join(' ');
  const labelClassName = isAndonFeature ? `${styles.mobileStationLabel} ${styles.mobileStationLabelAndon}` : styles.mobileStationLabel;

  return (
    <div className={styles.mobileStation}>
      <span className={labelClassName}>{meta.label}</span>
      {meta.pillar ? <span className={styles.mobileStationPillar}>{meta.pillar}</span> : null}
      <span className={styles.mobileProgress}>
        <span aria-hidden="true" className={markerClassName} />
        <span className={`num ${styles.cellText}`}>{rowLabel(feature)}</span>
      </span>
    </div>
  );
}

export interface LineBoardProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly lineBoard: LineBoardDto;
}

/**
 * "La línea": one row per initiative (a BC anchors its linked PRD(s) into the same row -- WO-443's row
 * collapsing -- a legacy PRD without a BC keeps its own), across the seven-station pipeline grouped into
 * the Negocio/Producto/Tecnología pillar band.
 */
export function LineBoard({ orgSlug, projectSlug, lineBoard }: LineBoardProps): ReactElement {
  const andon = lineBoard.andon;
  const andonStationIndex = andon ? stationIndex(andon.station) : -1;

  return (
    <section aria-label="La línea" className={styles.band}>
      <div className={styles.header}>
        <h2 className={styles.title}>La línea</h2>
        {andon ? (
          <p className={styles.andon}>
            <span aria-hidden="true" className={styles.andonDot} />
            Línea detenida en {STATION_META[andon.station].label}
          </p>
        ) : null}
      </div>

      <div className={`${styles.grid} ${styles.pillarRow}`} aria-hidden="true">
        <span />
        <span />
        <span className={`${styles.pillarCell} ${styles.pillarNegocio}`}>Negocio</span>
        <span className={`${styles.pillarCell} ${styles.pillarProducto}`}>Producto</span>
        <span className={`${styles.pillarCell} ${styles.pillarTecnologia}`}>Tecnología</span>
      </div>

      <div className={`${styles.grid} ${styles.stationHeaderRow}`} aria-hidden="true">
        <span className={styles.iniciativaHeader}>Iniciativa</span>
        {STATIONS.map((station, index) => (
          <span key={station} className={index === andonStationIndex ? styles.stationHeaderCellAndon : styles.stationHeaderCell}>
            <span className={styles.stationHeaderLabel}>{STATION_META[station].label}</span>
            <span className={styles.stationHeaderHelp}>{STATION_META[station].help}</span>
          </span>
        ))}
      </div>

      <ul className={styles.rows}>
        {lineBoard.features.map((feature) => {
          const isAndonFeature = andon?.featureId === feature.id;
          const secondary = secondaryLine(feature);
          return (
            <li key={feature.id} className={`${styles.grid} ${styles.row}`}>
              <Link
                to={`/o/${orgSlug}/p/${projectSlug}/arbol/${feature.id}`}
                className={styles.rowLead}
                aria-label={`${feature.id} ${feature.title}, estación ${STATION_META[feature.station].label}`}
              >
                <span className={styles.rowLeadLine}>
                  <span className={`id ${styles.rowId}`}>{feature.id}</span>
                  <span className={styles.rowTitle}>{feature.title}</span>
                </span>
                {secondary ? <span className={secondary.mono ? `id ${styles.rowSecondary}` : styles.rowSecondary}>{secondary.text}</span> : null}
              </Link>
              <MobileStation feature={feature} isAndonFeature={isAndonFeature} />
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
