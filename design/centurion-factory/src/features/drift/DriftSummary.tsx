import type { ReactElement } from 'react';
import { summarize } from './drift-data';
import { formatCount, formatPercent } from './drift-format';
import styles from './DriftSummary.module.css';

/** The 3-up summary strip from canvas/Drift.dc.html: errors, warnings and governed references. */
export function DriftSummary(): ReactElement {
  const counts = summarize();

  return (
    <section className={styles.summary} aria-label="Resumen de drift">
      <div className={styles.item}>
        <div className={styles.headline}>
          <span className={`${styles.dot} ${styles.dotError}`} aria-hidden="true" />
          <span className={`${styles.count} num`}>{counts.errors}</span>
          <span className={styles.unit}>errores</span>
        </div>
      </div>

      <div className={styles.item}>
        <div className={styles.headline}>
          <span className={`${styles.dot} ${styles.dotWarning}`} aria-hidden="true" />
          <span className={`${styles.count} num`}>{counts.warnings}</span>
          <span className={styles.unit}>avisos</span>
        </div>
      </div>

      <div className={styles.item}>
        <div className={styles.headline}>
          <span className={`${styles.count} num`}>{formatCount(counts.governedTotal)}</span>
          <span className={styles.unit}>referencias gobernadas</span>
        </div>
        <span className={styles.caption}>{formatPercent(counts.syncedPercent)} del código sincronizado</span>
      </div>
    </section>
  );
}
