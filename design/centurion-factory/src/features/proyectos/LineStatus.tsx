import type { ReactElement } from 'react';
import { STATIONS, type ProjectSummary } from '../../data';
import { lineLabel, stationIndex } from './lib';
import styles from './ProyectosPage.module.css';

export interface LineStatusProps {
  readonly project: Pick<ProjectSummary, 'furthestStation' | 'andonStation'>;
}

/** Mini 6-segment line: grafito up to the furthest station reached, andon where it stopped. */
export function LineStatus({ project }: LineStatusProps): ReactElement {
  const reached = stationIndex(project.furthestStation);
  const andonAt = project.andonStation ? stationIndex(project.andonStation) : 0;
  const label = lineLabel(project);

  return (
    <span className={styles.lineWrap}>
      <span className="visually-hidden">{label}</span>
      <span aria-hidden="true" className={styles.line}>
        {STATIONS.map((station, index) => {
          const position = index + 1;
          const segmentClass = position === andonAt ? styles.segAndon : position <= reached ? styles.segDone : styles.segPending;
          return <span key={station} className={`${styles.segment} ${segmentClass}`} />;
        })}
      </span>
    </span>
  );
}
