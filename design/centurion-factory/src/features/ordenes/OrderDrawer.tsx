import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Button, Drawer } from '../../components';
import { COMMITS, type WorkOrder } from '../../data';
import { ArchiveOrderModal } from './ArchiveOrderModal';
import { CompleteOrderModal } from './CompleteOrderModal';
import styles from './OrderDrawer.module.css';
import { OrderCommitsSection } from './OrderCommitsSection';
import { OrderCriteriaSection } from './OrderCriteriaSection';
import { OrderGovernedCodeSection } from './OrderGovernedCodeSection';
import { OrderHeader } from './OrderHeader';
import { OrderPrimaryAction } from './OrderPrimaryAction';
import { TakeOrderModal } from './TakeOrderModal';
import { CURRENT_HANDLE } from './actions';
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

  // Archiving is the exception path: the primary action stays the lifecycle one (Tomar / Completar / Retomar).
  const canArchive = order.status === 'pending' || order.status === 'in_progress' || order.status === 'out_of_sync';

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={order.title}
        footer={
          <div className={styles.footer}>
            <OrderPrimaryAction status={order.status} onTake={actions.openTake} onComplete={actions.openComplete} onRetake={actions.handleRetake} />
            {canArchive ? (
              <Button type="button" variant="secondary" onClick={actions.openArchive}>
                Archivar
              </Button>
            ) : null}
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

      <TakeOrderModal
        open={actions.takeOpen}
        orderId={order.id}
        handle={CURRENT_HANDLE}
        onClose={actions.closeTake}
        onConfirm={actions.handleTakeConfirm}
      />
      <ArchiveOrderModal open={actions.archiveOpen} orderId={order.id} onClose={actions.closeArchive} onConfirm={actions.handleArchiveConfirm} />
      <CompleteOrderModal open={actions.completeOpen} orderId={order.id} onClose={actions.closeComplete} onConfirm={actions.handleCompleteConfirm} />
    </>
  );
}
