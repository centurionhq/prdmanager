import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Drawer } from '../../components';
import { COMMITS, type WorkOrder } from '../../data';
import { CompleteOrderModal } from './CompleteOrderModal';
import styles from './OrderDrawer.module.css';
import { OrderCommitsSection } from './OrderCommitsSection';
import { OrderCriteriaSection } from './OrderCriteriaSection';
import { OrderGovernedCodeSection } from './OrderGovernedCodeSection';
import { OrderHeader } from './OrderHeader';
import { OrderPrimaryAction } from './OrderPrimaryAction';
import { TakeOrderModal } from './TakeOrderModal';
import { useOrderDrawerActions } from './useOrderDrawerActions';

export interface OrderDrawerProps {
  readonly order: WorkOrder;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onUpdate: (next: WorkOrder) => void;
}

/**
 * Right-side detail of one work order (WO-292): the objective, criteria, governed code and
 * commits, plus the primary action for its current status ("Tomar orden" / "Completar" /
 * "Retomar orden"). Closing the drawer returns focus to the row via the shared dialog controller.
 */
export function OrderDrawer({ order, open, onClose, onUpdate }: OrderDrawerProps): ReactElement {
  const actions = useOrderDrawerActions(order, onUpdate);
  const commits = order.commitShas.map((sha) => COMMITS.find((commit) => commit.sha === sha)).filter((commit) => commit !== undefined);

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={order.title}
        footer={
          <div className={styles.footer}>
            <OrderPrimaryAction status={order.status} onTake={actions.openTake} onComplete={actions.openComplete} onRetake={actions.handleRetake} />
            <Link to={`/documentos/${order.blueprintId}`} className={styles.blueprintLink}>
              Ver blueprint
            </Link>
          </div>
        }
      >
        <div className={styles.body}>
          <OrderHeader order={order} />
          <OrderCriteriaSection criteria={order.criteria} />
          <OrderGovernedCodeSection governedPaths={order.governedPaths} />
          <OrderCommitsSection commits={commits} />
        </div>
      </Drawer>

      <TakeOrderModal open={actions.takeOpen} onClose={actions.closeTake} onConfirm={actions.handleTakeConfirm} />
      <CompleteOrderModal open={actions.completeOpen} orderId={order.id} onClose={actions.closeComplete} onConfirm={actions.handleCompleteConfirm} />
    </>
  );
}
