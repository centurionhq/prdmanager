import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { IdTag, Severity } from '../../components';
import { formatRelativeTime } from './planta-format';
import { inProgressOrders, recentDriftIssues } from './planta-overview-data';
import styles from './PlantaOverview.module.css';

/** "Drift reciente" and "Órdenes en curso", the two-column section from canvas/Main.dc.html. */
export function PlantaOverview(): ReactElement {
  const issues = recentDriftIssues();
  const orders = inProgressOrders();

  return (
    <section className={styles.overview}>
      <div className={styles.column}>
        <div className={styles.columnHeader}>
          <h2 className={styles.columnTitle}>Drift reciente</h2>
          <Link to="/drift">Ver todo el drift</Link>
        </div>
        <ul className={styles.list}>
          {issues.map((issue) => (
            <li key={issue.id} className={styles.driftRow}>
              <Severity severity={issue.severity} />
              <span className={styles.driftMessage}>{issue.message}</span>
              <span className={`${styles.timestamp} num`}>{formatRelativeTime(issue.detectedAt)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.column}>
        <div className={styles.columnHeader}>
          <h2 className={styles.columnTitle}>Órdenes en curso</h2>
          <Link to="/ordenes">Ver órdenes</Link>
        </div>
        <ul className={styles.list}>
          {orders.map((order) => (
            <li key={order.id} className={styles.orderRow}>
              <IdTag id={order.id} />
              <span className={order.status === 'out_of_sync' ? styles.orderTitleParo : styles.orderTitle}>{order.title}</span>
              {order.assignedTo ? <span className="id">{order.assignedTo}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
