import type { CSSProperties, ReactElement } from 'react';
import { STATIONS, STATION_LABELS } from '../../data';
import { buildLineRows, findAndon } from './lineboard-data';
import { LineBoardRow } from './LineBoardRow';
import styles from './LineBoard.module.css';

function joinClasses(...values: (string | null | undefined | false)[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

/**
 * The dark grafito band: six station columns and one row per in-progress feature (WO-280).
 * Runs the orchestrated reveal once per mount (WO-281), guarded by prefers-reduced-motion in CSS.
 */
export function LineBoard(): ReactElement {
  const rows = buildLineRows();
  const andon = findAndon(rows);

  return (
    <section className={styles.band} data-reveal="line-board" aria-label="La línea">
      <div className={styles.heading}>
        <h2 className={styles.boardTitle}>La línea</h2>
        {andon ? (
          <p className={styles.andonSummary}>
            <span className={styles.andonDot} aria-hidden="true" />
            Línea detenida en {STATION_LABELS[andon.station]}: {andon.row.progress.stopped} órdenes fuera de sincronía en{' '}
            <span className="id">{andon.row.feature.id}</span>
          </p>
        ) : null}
      </div>

      <div className={styles.gridHeader} aria-hidden="true">
        <span className={styles.featureHeaderCell}>Feature</span>
        {STATIONS.map((station, index) => (
          <span
            key={station}
            className={joinClasses(styles.stationHeader, station === andon?.station ? styles.stationHeaderAndon : null)}
            style={{ '--station-delay': `${index * 120}ms` } as CSSProperties}
          >
            {STATION_LABELS[station]}
          </span>
        ))}
      </div>

      <ul className={styles.rows}>
        {rows.map((row, index) => (
          <LineBoardRow key={row.feature.id} row={row} index={index} andonStationIndex={andon?.stationIndex ?? -1} />
        ))}
      </ul>
    </section>
  );
}
