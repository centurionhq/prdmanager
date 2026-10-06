/**
 * WO-681 (SDD-084 D3/D6): the work orders of one initiative, opened from the line board's current-station
 * cell. Read from the feature branch (`getFeatureBranch`) -- no dedicated endpoint -- and each row links to
 * the Órdenes screen filtered by that order (`ordenes?q=<id>`, SDD-064 D7).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import type { SubgraphNode } from '@prdm/core';
import type { FeatureLineDto } from '@prdm/contracts';
import { getFeatureBranch } from '../../api/client.js';
import { errorMessage } from '../../api/error-message.js';
import { Drawer, ErrorState, IdTag, Skeleton, StatusBadge, type StatusBadgeWorkOrderStatus } from '../index.js';
import styles from './LineBoard.module.css';

/** `SubgraphNode.status` is a free `string | null`: only these reach `StatusBadge`, anything else is shown raw. */
const WORK_ORDER_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'out_of_sync', 'done', 'archived']);

interface OrdersState {
  readonly status: 'cargando' | 'listo' | 'error';
  readonly orders: readonly SubgraphNode[];
  readonly error: string;
}

export interface StationOrdersDrawerProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly feature: FeatureLineDto;
  readonly open: boolean;
  readonly panelId: string;
  readonly onClose: () => void;
}

function summary(feature: FeatureLineDto): string {
  const { done, total, stopped } = feature.progress;
  if (total === 0) return 'Sin órdenes activas';
  const orders = `${total} ${total === 1 ? 'orden' : 'órdenes'}`;
  const doneText = `${done} ${done === 1 ? 'hecha' : 'hechas'}`;
  const stoppedText = `${stopped} ${stopped === 1 ? 'parada' : 'paradas'}`;
  return `${orders} · ${doneText} · ${stoppedText}`;
}

export function StationOrdersDrawer({ orgSlug, projectSlug, feature, open, panelId, onClose }: StationOrdersDrawerProps): ReactElement {
  const [state, setState] = useState<OrdersState>({ status: 'cargando', orders: [], error: '' });

  function load(): void {
    setState({ status: 'cargando', orders: [], error: '' });
    getFeatureBranch(orgSlug, projectSlug, feature.id)
      .then((sub) => setState({ status: 'listo', orders: sub.nodes.filter((n) => n.label === 'WorkOrder'), error: '' }))
      .catch((err: unknown) => setState({ status: 'error', orders: [], error: errorMessage(err) }));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` closes over its own deps only.
  }, [orgSlug, projectSlug, feature.id]);

  return (
    <Drawer open={open} title={`${feature.id} ${feature.title}`} onClose={onClose} width={520}>
      <div id={panelId} className={styles.ordersBody}>
        <p className={`num ${styles.ordersSummary}`}>{summary(feature)}</p>
        {state.status === 'cargando' ? <Skeleton rows={3} /> : null}
        {state.status === 'error' ? <ErrorState title="No pudimos cargar las órdenes" body={state.error} onRetry={load} /> : null}
        {state.status === 'listo' && state.orders.length === 0 ? (
          <p className={styles.ordersEmpty}>Todavía no hay órdenes para esta iniciativa.</p>
        ) : null}
        {state.status === 'listo' && state.orders.length > 0 ? (
          <ul className={styles.orderList}>
            {state.orders.map((order) => (
              <li key={order.ref}>
                <Link
                  to={`/o/${orgSlug}/p/${projectSlug}/ordenes?q=${encodeURIComponent(order.ref)}`}
                  className={styles.orderRow}
                  aria-label={`${order.ref} ${order.title}`}
                >
                  <IdTag id={order.ref} />
                  <span className={styles.orderTitle}>{order.title}</span>
                  {order.status !== null && WORK_ORDER_STATUSES.has(order.status) ? (
                    <StatusBadge kind="workOrder" status={order.status as StatusBadgeWorkOrderStatus} />
                  ) : (
                    <span className={`id ${styles.orderStatusRaw}`}>{order.status ?? '—'}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Drawer>
  );
}
