import { Check } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { Button, Drawer, StatusBadge, useToast } from '../../components';
import { CODE_REFS, COMMITS, type ActorRef, type WorkOrder } from '../../data';
import { completeOrder, retakeOrder, takeOrder } from './actions';
import { CompleteOrderModal } from './CompleteOrderModal';
import { formatDateEs } from './format';
import styles from './OrderDrawer.module.css';
import { TakeOrderModal } from './TakeOrderModal';

export interface OrderDrawerProps {
  readonly order: WorkOrder;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onUpdate: (next: WorkOrder) => void;
}

function codeSyncStatus(path: string): 'synced' | 'out_of_sync' {
  return CODE_REFS.find((ref) => ref.path === path)?.status ?? 'synced';
}

/**
 * Right-side detail of one work order (WO-292): the objective, criteria, governed code and
 * commits, plus the primary action for its current status ("Tomar orden" / "Completar" /
 * "Retomar orden"). Closing the drawer returns focus to the row via the shared dialog controller.
 */
export function OrderDrawer({ order, open, onClose, onUpdate }: OrderDrawerProps): ReactElement {
  const { show } = useToast();
  const [takeOpen, setTakeOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  function handleTakeConfirm(assignee: ActorRef): void {
    onUpdate(takeOrder(order, assignee));
    setTakeOpen(false);
    show('Orden tomada', { tone: 'success' });
  }

  function handleRetake(): void {
    onUpdate(retakeOrder(order));
    show('Orden retomada', { tone: 'success' });
  }

  function handleCompleteConfirm(sha: string): void {
    onUpdate(completeOrder(order, sha));
    setCompleteOpen(false);
    show('Orden completada', { tone: 'success' });
  }

  const commits = order.commitShas.map((sha) => COMMITS.find((commit) => commit.sha === sha)).filter((commit) => commit !== undefined);

  const primaryAction = (() => {
    if (order.status === 'pending') {
      return (
        <Button type="button" variant="primary" onClick={() => setTakeOpen(true)}>
          Tomar orden
        </Button>
      );
    }
    if (order.status === 'in_progress') {
      return (
        <Button type="button" variant="primary" onClick={() => setCompleteOpen(true)}>
          Completar
        </Button>
      );
    }
    if (order.status === 'out_of_sync') {
      return (
        <Button type="button" variant="primary" onClick={handleRetake}>
          Retomar orden
        </Button>
      );
    }
    return null;
  })();

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={order.title}
        footer={
          <div className={styles.footer}>
            {primaryAction}
            <Link to={`/documentos/${order.blueprintId}`} className={styles.blueprintLink}>
              Ver blueprint
            </Link>
          </div>
        }
      >
        <div className={styles.body}>
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

          {order.status === 'out_of_sync' && order.outOfSyncReason ? (
            <div className={styles.outOfSyncBox}>{order.outOfSyncReason}</div>
          ) : null}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Objetivo</h3>
            <p className={styles.objective}>{order.objective}</p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Criterios de aceptación</h3>
            <ul className={styles.criteria}>
              {order.criteria.map((criterion) => (
                <li key={criterion.text} className={styles.criterion}>
                  <span className={[styles.criterionMark, criterion.done ? styles.criterionDone : null].filter(Boolean).join(' ')} aria-hidden="true">
                    {criterion.done ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  <span>{criterion.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Código gobernado</h3>
            <ul className={styles.paths}>
              {order.governedPaths.map((path) => {
                const status = codeSyncStatus(path);
                return (
                  <li key={path} className={styles.pathRow}>
                    <span className="id">{path}</span>
                    <span className={[styles.pathStatus, status === 'synced' ? styles.pathSynced : styles.pathOutOfSync].join(' ')}>
                      {status === 'synced' ? 'Sincronizado' : 'Fuera de sincronía'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Commits</h3>
            {commits.length > 0 ? (
              <ul className={styles.commits}>
                {commits.map((commit) => (
                  <li key={commit.sha} className={styles.commitRow}>
                    <span className="id">{commit.sha}</span>
                    <span>{commit.subject}</span>
                    <span className={styles.commitMeta}>
                      <span className="id">{commit.author}</span> · {formatDateEs(commit.date)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.noCommits}>Todavía no hay commits para esta orden.</p>
            )}
          </section>
        </div>
      </Drawer>

      <TakeOrderModal open={takeOpen} onClose={() => setTakeOpen(false)} onConfirm={handleTakeConfirm} />
      <CompleteOrderModal open={completeOpen} orderId={order.id} onClose={() => setCompleteOpen(false)} onConfirm={handleCompleteConfirm} />
    </>
  );
}
