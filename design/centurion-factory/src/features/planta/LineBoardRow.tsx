import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';
import { STATIONS, STATION_LABELS } from '../../data';
import type { WorkOrderProgress } from '../../data';
import type { LineRow, LineRowKind } from './lineboard-data';
import { rowAccessibleName, rowLabel, stationIndex } from './lineboard-data';
import styles from './LineBoard.module.css';

export interface LineBoardRowProps {
  readonly row: LineRow;
  readonly index: number;
  readonly andonStationIndex: number;
}

const MARKER_CLASS: Record<LineRowKind, string> = {
  closed: styles.markerSenal ?? '',
  draft: styles.markerHollow ?? '',
  stopped: styles.markerAndon ?? '',
  complete: styles.markerSenal ?? '',
  default: styles.markerFilled ?? '',
};

function joinClasses(...values: (string | null | undefined | false)[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

type SegmentKind = 'done' | 'stopped' | 'pending';

const SEGMENT_CLASS: Record<SegmentKind, string> = {
  done: styles.barSegmentDone ?? '',
  stopped: styles.barSegmentStopped ?? '',
  pending: styles.barSegmentPending ?? '',
};

function segmentKindAt(position: number, progress: WorkOrderProgress): SegmentKind {
  if (position < progress.done) return 'done';
  if (position < progress.done + progress.stopped) return 'stopped';
  return 'pending';
}

function SegmentedBar({ progress }: { readonly progress: WorkOrderProgress }): ReactElement {
  const segments = Array.from({ length: progress.total }, (_, position) => segmentKindAt(position, progress));

  return (
    <span className={styles.bar} aria-hidden="true">
      {segments.map((kind, position) => (
        // eslint-disable-next-line react/no-array-index-key -- segments have no identity of their own
        <span key={position} className={joinClasses(styles.barSegment, SEGMENT_CLASS[kind])} />
      ))}
    </span>
  );
}

function MarkerCell({ row }: { readonly row: LineRow }): ReactElement {
  return (
    <>
      <span className={joinClasses(styles.marker, MARKER_CLASS[row.kind])} aria-hidden="true" />
      <span className={styles.cellLabel}>{rowLabel(row)}</span>
      {row.kind === 'stopped' ? <SegmentedBar progress={row.progress} /> : null}
    </>
  );
}

function renderStationCell(row: LineRow, station: (typeof STATIONS)[number], cellIndex: number, andonStationIndex: number): ReactNode {
  const ownIndex = stationIndex(row.feature.station);
  const isTrack = cellIndex < ownIndex;
  const isMarkerCell = cellIndex === ownIndex;
  const classes = joinClasses(
    styles.cell,
    isTrack ? styles.cellTrack : null,
    isMarkerCell ? styles.cellMarker : null,
    cellIndex === andonStationIndex ? styles.cellAndonTint : null,
  );

  // WO-680 (SDD-084 D4): the stopped cell is no longer the drift link — the notice above now carries
  // that destination for every stopped initiative. WO-681 turns this cell into the orders button.
  if (isMarkerCell) {
    return (
      <span key={station} className={classes}>
        <MarkerCell row={row} />
      </span>
    );
  }

  if (isTrack) {
    return (
      <span key={station} className={classes}>
        <span className={styles.trackLine} aria-hidden="true" />
      </span>
    );
  }

  return <span key={station} className={classes} />;
}

/** One feature's row: identity link, per-station track/marker cells, and the mobile station label. */
export function LineBoardRow({ row, index, andonStationIndex }: LineBoardRowProps): ReactElement {
  const { feature, kind } = row;
  const rowStyle = { '--row-delay': `${700 + index * 90}ms` } as CSSProperties;
  const rowClasses = joinClasses(styles.row, kind === 'closed' ? styles.rowClosed : null);

  return (
    <li className={rowClasses} style={rowStyle}>
      <Link to={`/arbol/${feature.id}`} className={styles.identity} aria-label={rowAccessibleName(row)}>
        <span className="id">{feature.id}</span>
        <span className={styles.featureTitle}>{feature.title}</span>
        {/* WO-680 (SDD-084 D2): the stopped station spelled out, next to its own andon marker. */}
        {kind === 'stopped' ? (
          <span className={styles.rowStop}>
            <span className={styles.rowStopMarker} aria-hidden="true" />
            detenida en {STATION_LABELS[feature.station]}
          </span>
        ) : null}
      </Link>
      <span className={styles.mobileStation}>{STATION_LABELS[feature.station]}</span>
      <div className={styles.stations}>{STATIONS.map((station, cellIndex) => renderStationCell(row, station, cellIndex, andonStationIndex))}</div>
    </li>
  );
}
