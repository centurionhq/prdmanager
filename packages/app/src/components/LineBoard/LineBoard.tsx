/**
 * "La línea" — the Centurion Factory line board's seven-station band (originally SDD-012 "Centurion
 * Factory conectado al backend SaaS", WO-354; rebuilt as a design-system component and expanded to seven
 * stations plus BC/PRD row nesting by SDD-024/PRD-011 §4.3-§4.5, WO-445; notice rewritten by WO-680,
 * SDD-084). Approved canvas: `design/centurion-factory/canvas/Main.dc.html` (desktop) /
 * `PlantaMobile.dc.html` (375px) — both render the same DOM, toggled by `LineBoard.module.css`'s
 * `@media (max-width: 767px)` rather than two branches of JSX, the same convention `DataTable` already
 * uses for its own mobile stack.
 */
import { type ReactElement } from 'react';
import { Link } from 'react-router';
import { STATIONS, type FeatureLineDto, type LineBoardDto, type Station } from '@prdm/contracts';
import { Tooltip } from '../Tooltip/Tooltip';
import styles from './LineBoard.module.css';

interface StationMeta {
  readonly label: string;
  readonly help: string;
  readonly pillar: 'Negocio' | 'Producto' | 'Tecnología' | null;
}

/** WO-455 (SDD-027): `help` names the document that lives in the step, not the condition that lights the
 * station up ("Idea o feedback sin evaluar", not "Llegó sin evaluar"), and it is shown in a `Tooltip`
 * instead of inline under the title -- see this component's own doc comment. */
const STATION_META: Record<Station, StationMeta> = {
  entrada: { label: 'Entrada', help: 'Idea o feedback sin evaluar', pillar: null },
  caso_negocio: { label: 'Caso de negocio', help: 'El BC: por qué conviene hacerlo', pillar: 'Negocio' },
  producto: { label: 'Producto', help: 'El PRD o FR: qué construimos', pillar: 'Producto' },
  diseno_tecnico: { label: 'Diseño técnico', help: 'El SDD o ADR: cómo lo hacemos', pillar: 'Tecnología' },
  planificacion: { label: 'Planificación', help: 'Órdenes de trabajo generadas, sin arrancar', pillar: 'Tecnología' },
  construccion: { label: 'Construcción', help: 'Órdenes de trabajo en curso', pillar: 'Tecnología' },
  entregado: { label: 'Entregado', help: 'Cerrado, o todas las órdenes resueltas', pillar: null },
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

/** WO-680 (SDD-084 D2): a row is stopped when the DTO carries `andonStation` for it, whether or not it is
 * the project-wide `andon` (`lineBoard.andon`). Before this WO only `andon.featureId === feature.id`
 * counted, so a second stopped initiative was invisible/inerte. */
function isStoppedFeature(feature: FeatureLineDto): boolean {
  return feature.andonStation !== undefined;
}

/** WO-680 (SDD-084 D2): the row's accessible name names the stopped station in text, so the stop never
 * depends on the column tint (WCAG 1.4.1). */
function rowAccessibleName(feature: FeatureLineDto): string {
  const base = `${feature.id} ${feature.title}, estación ${STATION_META[feature.station].label}`;
  return feature.andonStation === undefined ? base : `${base}, línea detenida en ${STATION_META[feature.andonStation].label}`;
}

/** WO-680 (SDD-084 D1): the initiatives the line is stopped on, read from the per-feature
 * `andonStation` core already ships (`issue-attribution.ts:97-102`, propagated recursively into a BC's
 * nested children) — the app used to ignore it entirely. Nested children are listed even though the
 * board draws no row for them: for a collapsed PRD the notice is its only way in. */
interface StoppedInitiative {
  readonly feature: FeatureLineDto;
  readonly station: Station;
}

function collectStopped(features: readonly FeatureLineDto[], acc: StoppedInitiative[] = []): StoppedInitiative[] {
  for (const feature of features) {
    if (feature.andonStation !== undefined) acc.push({ feature, station: feature.andonStation });
    collectStopped(feature.children, acc);
  }
  return acc;
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
  readonly feature: FeatureLineDto;
  readonly station: Station;
  readonly cellIndex: number;
  readonly isAndonColumn: boolean;
  readonly isAndonRow: boolean;
}

function StationCell({ feature, station, cellIndex, isAndonColumn, isAndonRow }: StationCellProps): ReactElement {
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
  const markerClassName = [styles.cellMarker, isAndonRow ? styles.cellMarkerAndon : done ? styles.cellMarkerDone : null].filter(Boolean).join(' ');
  const textClassName = isAndonRow ? `${styles.cellText} ${styles.cellTextAndon}` : styles.cellText;

  // WO-680 (SDD-084 D4): the cell is no longer the drift link — that destination moved to the notice
  // above, which links every stopped initiative. WO-681 turns this cell into the button that opens the
  // initiative's work orders; until then it stays inert.
  return (
    <span key={station} className={cellClassName}>
      <span aria-hidden="true" className={markerClassName} />
      <span className={`num ${textClassName}`}>{rowLabel(feature)}</span>
    </span>
  );
}

interface MobileStationProps {
  readonly feature: FeatureLineDto;
  readonly isAndonRow: boolean;
}

/** The 375px layout's left column (`PlantaMobile.dc.html`): current station + pillar, replacing the
 * desktop rail's seven cells — CSS-only toggle, see this component's own doc comment. */
function MobileStation({ feature, isAndonRow }: MobileStationProps): ReactElement {
  const meta = STATION_META[feature.station];
  const done = feature.progress.done === feature.progress.total && feature.progress.total > 0;
  const markerClassName = [styles.cellMarker, isAndonRow ? styles.cellMarkerAndon : done ? styles.cellMarkerDone : null].filter(Boolean).join(' ');
  const labelClassName = isAndonRow ? `${styles.mobileStationLabel} ${styles.mobileStationLabelAndon}` : styles.mobileStationLabel;

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
  const andonStationIndex = lineBoard.andon === null ? -1 : stationIndex(lineBoard.andon.station);
  // WO-680 (SDD-084 D1): earliest stop first, the same criterion core uses to pick the project-wide
  // andon (`issue-attribution.ts:104-110`); `sort` is stable, so equal stations keep their board order.
  const stopped = collectStopped(lineBoard.features).sort((a, b) => stationIndex(a.station) - stationIndex(b.station));

  return (
    <section aria-label="La línea" className={styles.band}>
      <div className={styles.header}>
        <h2 className={styles.title}>La línea</h2>
        {/* WO-680 (SDD-084 D1/D4): the notice names and links *every* stopped initiative (id + title +
          * station) instead of printing only the station. It carries the `drift?feature=` destination
          * the andon cell used to own. */}
        {stopped.length > 0 ? (
          <ul className={styles.andon} aria-label="Iniciativas detenidas">
            {stopped.map(({ feature, station }) => (
              <li key={feature.id}>
                <Link
                  to={`/o/${orgSlug}/p/${projectSlug}/drift?feature=${encodeURIComponent(feature.id)}`}
                  className={styles.andonLink}
                  aria-label={`${feature.id} ${feature.title}, línea detenida en ${STATION_META[station].label}. Ver drift.`}
                >
                  <span aria-hidden="true" className={styles.andonDot} />
                  <span className={`id ${styles.andonId}`}>{feature.id}</span>
                  <span className={styles.andonTitle}>{feature.title}</span>
                  <span className={styles.andonStation}>detenida en {STATION_META[station].label}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className={`${styles.grid} ${styles.pillarRow}`} aria-hidden="true">
        <span />
        <span />
        <span className={`${styles.pillarCell} ${styles.pillarNegocio}`}>Negocio</span>
        <span className={`${styles.pillarCell} ${styles.pillarProducto}`}>Producto</span>
        <span className={`${styles.pillarCell} ${styles.pillarTecnologia}`}>Tecnología</span>
      </div>

      {/* WO-455: no longer `aria-hidden`. Each station title is now a focusable Tooltip trigger, and a
          focusable node inside an `aria-hidden` subtree is exactly the combination screen readers choke
          on — so the header becomes real content, which also gives assistive tech the pipeline's own
          explanation up front. */}
      <div className={`${styles.grid} ${styles.stationHeaderRow}`}>
        <span className={styles.iniciativaHeader}>Iniciativa</span>
        {STATIONS.map((station, index) => (
          <span key={station} className={index === andonStationIndex ? styles.stationHeaderCellAndon : styles.stationHeaderCell}>
            {/* The andon column's own background is `--andon` (light), so its trigger keeps the default
                dark dotted underline; every other column sits on the dark band. */}
            <Tooltip text={STATION_META[station].help} tone={index === andonStationIndex ? 'light' : 'onDark'}>
              <span className={styles.stationHeaderLabel}>{STATION_META[station].label}</span>
            </Tooltip>
          </span>
        ))}
      </div>

      <ul className={styles.rows}>
        {lineBoard.features.map((feature) => {
          const isStopped = isStoppedFeature(feature);
          const secondary = secondaryLine(feature);
          return (
            <li key={feature.id} className={`${styles.grid} ${styles.row}`}>
              <Link
                to={`/o/${orgSlug}/p/${projectSlug}/arbol/${feature.id}`}
                className={styles.rowLead}
                aria-label={rowAccessibleName(feature)}
              >
                <span className={styles.rowLeadLine}>
                  <span className={`id ${styles.rowId}`}>{feature.id}</span>
                  <span className={styles.rowTitle}>{feature.title}</span>
                </span>
                {/* WO-680 (SDD-084 D2): the stopped station is spelled out next to the row, so the stop
                  * is readable without relying on the andon tint. */}
                {feature.andonStation !== undefined ? (
                  <span className={styles.rowStop}>
                    <span aria-hidden="true" className={styles.rowStopMarker} />
                    detenida en {STATION_META[feature.andonStation].label}
                  </span>
                ) : null}
                {secondary ? <span className={secondary.mono ? `id ${styles.rowSecondary}` : styles.rowSecondary}>{secondary.text}</span> : null}
              </Link>
              <MobileStation feature={feature} isAndonRow={isStopped} />
              {STATIONS.map((station, cellIndex) => (
                <StationCell
                  key={station}
                  feature={feature}
                  station={station}
                  cellIndex={cellIndex}
                  isAndonColumn={cellIndex === andonStationIndex}
                  isAndonRow={isStopped && cellIndex === stationIndex(feature.station)}
                />
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
