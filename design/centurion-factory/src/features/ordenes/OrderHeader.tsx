/** OrderDrawer's header: ids, status/assignee line, the out-of-sync callout and the objective. */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../components';
import type { WorkOrder } from '../../data';
import styles from './OrderDrawer.module.css';

export interface OrderHeaderProps {
  readonly order: WorkOrder;
}

export function OrderHeader({ order }: OrderHeaderProps): ReactElement {
  return (
    <>
      <div className={styles.idLine}>
        <span className="id">{order.id}</span>
        <span aria-hidden="true">·</span>
        <span className="id">{order.featureId}</span>
        <span aria-hidden="true">·</span>
        <span className="id">{order.blueprintId}</span>
      </div>

      <div className={styles.statusLine}>
        <StatusBadge kind="workOrder" status={order.status} />
        <span className={styles.assignee}>
          {order.assignedTo ? (
            <>
              Asignada a <span className="id">{order.assignedTo}</span>
            </>
          ) : (
            'Sin asignar'
          )}
        </span>
      </div>

      {order.status === 'out_of_sync' && order.outOfSyncReason ? <div className={styles.outOfSyncBox}>{order.outOfSyncReason}</div> : null}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Objetivo</h3>
        <p className={styles.objective}>{order.objective}</p>
      </section>
    </>
  );
}
