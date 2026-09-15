import { useState, type ReactElement } from 'react';
import { EmptyState, ErrorState, PageHeader, SearchField, Skeleton } from '../../components';
import { BLUEPRINTS, WORK_ORDERS, type WorkOrder } from '../../data';
import { useDemoState } from '../../lib/use-demo-state';
import styles from './OrdenesPage.module.css';
import { OrdenesTable } from './OrdenesTable';
import { OrderDrawer } from './OrderDrawer';
import { useOrdenesFilters } from './useOrdenesFilters';
import { useOrderDrawerState } from './useOrderDrawerState';

/** Órdenes de trabajo: search, filter, sort and page through every work order (WO-291). */
export function OrdenesPage(): ReactElement {
  const { state, retry } = useDemoState();
  const [orders, setOrders] = useState<readonly WorkOrder[]>(WORK_ORDERS);
  const filters = useOrdenesFilters(orders);
  const drawer = useOrderDrawerState(orders);

  function updateOrder(next: WorkOrder): void {
    setOrders((previous) => previous.map((order) => (order.id === next.id ? next : order)));
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Órdenes de trabajo"
        subtitle={state === 'vacio' || state === 'error' ? undefined : `${orders.length} órdenes en ${BLUEPRINTS.length} blueprints`}
        actions={<SearchField label="Buscar órdenes" value={filters.query} onChange={filters.setQuery} placeholder="Buscar órdenes" hideLabel />}
      />

      {state === 'cargando' ? <Skeleton rows={8} columns={6} /> : null}

      {state === 'error' ? (
        <ErrorState title="No pudimos cargar las órdenes" body="Algo falló al traerlas. Volvé a intentarlo." onRetry={retry} />
      ) : null}

      {state === 'vacio' ? (
        <EmptyState title="Todavía no hay órdenes de trabajo" body="Cuando se generen órdenes para este proyecto, van a aparecer acá." />
      ) : null}

      {state === 'listo' ? (
        <div className={styles.body}>
          <OrdenesTable filters={filters} drawer={drawer} />
          {drawer.drawerOrder ? (
            <OrderDrawer order={drawer.drawerOrder} open={Boolean(drawer.openOrder)} onClose={drawer.closeOrderDrawer} onUpdate={updateOrder} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
