import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { workOrdersForFeature } from '../../data';
import { Drawer } from '../../components/Drawer/Drawer';
import { IdTag } from '../../components/IdTag/IdTag';
import { StatusBadge, type StatusBadgeWorkOrderStatus } from '../../components/StatusBadge/StatusBadge';
import { ordersSummary } from './lineboard-data';
import type { LineRow } from './lineboard-data';
import styles from './LineBoard.module.css';

export interface LineOrdersDrawerProps {
  readonly row: LineRow;
  readonly open: boolean;
  readonly panelId: string;
  readonly onClose: () => void;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'out_of_sync', 'done']);

/** WO-681 (SDD-084 D3/D6): the initiative's work orders, opened from the station cell. An order whose
 * status the badge does not know is shown raw rather than invented. */
export function LineOrdersDrawer({ row, open, panelId, onClose }: LineOrdersDrawerProps): ReactElement {
  const orders = workOrdersForFeature(row.feature.id);

  return (
    <Drawer open={open} title={`${row.feature.id} ${row.feature.title}`} onClose={onClose} width={520}>
      <div id={panelId} className={styles.ordersBody}>
        <p className={`num ${styles.ordersSummary}`}>{ordersSummary(row.progress)}</p>
        {orders.length === 0 ? (
          <p className={styles.ordersEmpty}>Todavía no hay órdenes para esta iniciativa.</p>
        ) : (
          <ul className={styles.orderList}>
            {orders.map((order) => (
              <li key={order.id}>
                <Link to={`/ordenes?q=${encodeURIComponent(order.id)}`} className={styles.orderRow} aria-label={`${order.id} ${order.title}`}>
                  <IdTag id={order.id} />
                  <span className={styles.orderTitle}>{order.title}</span>
                  {KNOWN_STATUSES.has(order.status) ? (
                    <StatusBadge kind="workOrder" status={order.status as StatusBadgeWorkOrderStatus} />
                  ) : (
                    <span className={`id ${styles.orderStatusRaw}`}>{order.status}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
