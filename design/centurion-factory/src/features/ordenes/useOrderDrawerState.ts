/**
 * Which order's drawer is open, synced with the `?orden=` search param. Extracted from OrdenesPage
 * (WO-319).
 *
 * The Drawer must stay mounted while it closes so its dialog controller can return focus to the
 * row that opened it; unmounting it the instant `orden` leaves the URL would instead drop focus to
 * <body>. `drawerOrder` keeps the last opened order around; `openOrder` still tracks the URL, so
 * the dialog itself closes normally.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { WorkOrder } from '../../data';

export interface UseOrderDrawerStateResult {
  readonly openOrderId: string | undefined;
  readonly openOrder: WorkOrder | undefined;
  readonly drawerOrder: WorkOrder | undefined;
  readonly openOrderDrawer: (order: WorkOrder) => void;
  readonly closeOrderDrawer: () => void;
}

export function useOrderDrawerState(orders: readonly WorkOrder[]): UseOrderDrawerStateResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const openOrderId = searchParams.get('orden') ?? undefined;
  const openOrder = orders.find((order) => order.id === openOrderId);

  const [drawerOrder, setDrawerOrder] = useState<WorkOrder | undefined>(undefined);
  useEffect(() => {
    if (openOrder) setDrawerOrder(openOrder);
  }, [openOrder]);

  function openOrderDrawer(order: WorkOrder): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('orden', order.id);
      return next;
    });
  }

  function closeOrderDrawer(): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('orden');
      return next;
    });
  }

  return { openOrderId, openOrder, drawerOrder, openOrderDrawer, closeOrderDrawer };
}
