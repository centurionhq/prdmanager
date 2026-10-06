import type { CSSProperties, ReactElement } from 'react';
import { Link } from 'react-router';
import { STATIONS, STATION_LABELS } from '../../data';
import { buildLineRows, findStopped, stationIndex } from './lineboard-data';
import { LineBoardRow } from './LineBoardRow';
import styles from './LineBoard.module.css';

function joinClasses(...values: (string | null | undefined | false)[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

/**
 * The dark grafito band: six station columns and one row per in-progress feature (WO-280).
 * Runs the orchestrated reveal once per mount (WO-281), guarded by prefers-reduced-motion in CSS.
 *
 * WO-680 (SDD-084 D1/D4): the notice is a list, one row per stopped initiative, each naming its id,
 * title and station and linking to that initiative's drift; the station cell is no longer that link.
 */
export function LineBoard(): ReactElement {
  const rows = buildLineRows();
  const stopped = findStopped(rows);
  const andonStation = stopped[0]?.feature.station;

  return (
    <section className={styles.band} data-reveal="line-board" aria-label="La línea">
      <div className={styles.heading}>
        <h2 className={styles.boardTitle}>La línea</h2>
        {stopped.length > 0 ? (
          <ul className={styles.andon} aria-label="Iniciativas detenidas">
            {stopped.map((row) => (
              <li key={row.feature.id}>
                <Link
                  to={`/drift?feature=${row.feature.id}`}
                  className={styles.andonLink}
                  aria-label={`${row.feature.id} ${row.feature.title}, línea detenida en ${STATION_LABELS[row.feature.station]}. Ver drift.`}
                >
                  <span className={styles.andonDot} aria-hidden="true" />
                  <span className="id">{row.feature.id}</span>
                  <span className={styles.andonTitle}>{row.feature.title}</span>
                  <span className={styles.andonStation}>detenida en {STATION_LABELS[row.feature.station]}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className={styles.gridHeader} aria-hidden="true">
        <span className={styles.featureHeaderCell}>Feature</span>
        {STATIONS.map((station, index) => (
          <span
            key={station}
            className={joinClasses(styles.stationHeader, station === andonStation ? styles.stationHeaderAndon : null)}
            style={{ '--station-delay': `${index * 120}ms` } as CSSProperties}
          >
            {STATION_LABELS[station]}
          </span>
        ))}
      </div>

      <ul className={styles.rows}>
        {rows.map((row, index) => (
          <LineBoardRow key={row.feature.id} row={row} index={index} andonStationIndex={andonStation === undefined ? -1 : stationIndex(andonStation)} />
        ))}
      </ul>
    </section>
  );
}
