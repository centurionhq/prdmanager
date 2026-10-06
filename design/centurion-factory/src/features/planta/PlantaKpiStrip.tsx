import type { ReactElement } from 'react';
import { buildKpis } from './planta-overview-data';
import styles from './PlantaKpiStrip.module.css';

/** The 5-up KPI strip separated by rules, from canvas/Main.dc.html. */
export function PlantaKpiStrip(): ReactElement {
  const kpis = buildKpis();

  return (
    <section className={styles.strip} aria-label="Indicadores de la planta">
      {kpis.map((kpi) => (
        <div key={kpi.label} className={styles.item}>
          <span className={styles.label}>{kpi.label}</span>
          <span className={`${styles.value} num`}>{kpi.value}</span>
        </div>
      ))}
    </section>
  );
}
