/** The OrderDrawer footer's primary action button, chosen by the order's current status. */
import type { ReactElement } from 'react';
import { Button } from '../../components';
import type { WorkOrder } from '../../data';

export interface OrderPrimaryActionProps {
  readonly status: WorkOrder['status'];
  readonly onTake: () => void;
  readonly onComplete: () => void;
  readonly onRetake: () => void;
}

export function OrderPrimaryAction({ status, onTake, onComplete, onRetake }: OrderPrimaryActionProps): ReactElement | null {
  if (status === 'pending') {
    return (
      <Button type="button" variant="primary" onClick={onTake}>
        Tomar orden
      </Button>
    );
  }
  if (status === 'in_progress') {
    return (
      <Button type="button" variant="primary" onClick={onComplete}>
        Completar
      </Button>
    );
  }
  if (status === 'out_of_sync') {
    return (
      <Button type="button" variant="primary" onClick={onRetake}>
        Retomar orden
      </Button>
    );
  }
  return null;
}
