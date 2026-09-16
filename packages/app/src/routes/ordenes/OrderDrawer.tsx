/**
 * `/o/:orgSlug/p/:projectSlug/ordenes` (SDD-013 §"Shell y router", WO-360): one work order's real
 * context (`getWorkOrderContext`) in a `Drawer`, plus "Tomar orden" (`claimWorkOrder`) and "Completar"
 * (`completeWorkOrder`) — matching `Ordenes.dc.html`'s "Resumen del importador" aside.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { WorkOrderContextDto } from '@prdm/contracts';
import type { WorkOrderSummary } from '@prdm/core';
import { ApiClientError, claimWorkOrder, completeWorkOrder, getWorkOrderContext } from '../../api/client.js';
import { errorMessage } from '../../api/error-message.js';
import { Button, Drawer, ErrorState, IdTag, Severity, Skeleton, StatusBadge, useToast } from '../../components/index.js';
import { CompleteOrderModal } from './CompleteOrderModal.js';
import { asWorkOrderStatus } from './ordenes-filters.js';
import styles from './OrderDrawer.module.css';

export interface OrderDrawerProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly workOrderId: string;
  readonly onClose: () => void;
  readonly onChanged: (next: WorkOrderSummary) => void;
}

const COMMIT_NOT_VERIFIED_MESSAGE =
  'Ese commit todavía no fue verificado por CI. Esperá el próximo reporte de CI sobre la rama por defecto antes de completar la orden.';

export function OrderDrawer({ orgSlug, projectSlug, workOrderId, onClose, onChanged }: OrderDrawerProps): ReactElement {
  const { show } = useToast();
  const [context, setContext] = useState<WorkOrderContextDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  function load(): void {
    setContext(null);
    setLoadError(null);
    getWorkOrderContext(orgSlug, projectSlug, workOrderId)
      .then(setContext)
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` closes over its own deps only.
  }, [orgSlug, projectSlug, workOrderId]);

  async function handleClaim(): Promise<void> {
    setClaiming(true);
    try {
      const updated = await claimWorkOrder(orgSlug, projectSlug, workOrderId);
      onChanged(updated);
      show('Orden tomada', { tone: 'success' });
      load();
    } catch (err) {
      show(errorMessage(err));
    } finally {
      setClaiming(false);
    }
  }

  async function handleComplete(commitSha: string): Promise<void> {
    setCompleting(true);
    setCompleteError(null);
    try {
      const updated = await completeWorkOrder(orgSlug, projectSlug, workOrderId, commitSha);
      onChanged(updated);
      setCompleteOpen(false);
      show('Orden completada', { tone: 'success' });
      load();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setCompleteError(COMMIT_NOT_VERIFIED_MESSAGE);
      } else {
        setCompleteError(errorMessage(err));
      }
    } finally {
      setCompleting(false);
    }
  }

  const status = context ? asWorkOrderStatus(context.workOrder.status) : undefined;
  const canClaim = context?.workOrder.status === 'pending';
  const canComplete = context?.workOrder.status === 'in_progress' || context?.workOrder.status === 'out_of_sync';

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={context?.workOrder.title ?? workOrderId}
        footer={
          context ? (
            <div className={styles.footer}>
              {canClaim ? (
                <Button type="button" variant="primary" disabled={claiming} onClick={() => void handleClaim()}>
                  Tomar orden
                </Button>
              ) : null}
              {canComplete ? (
                <Button type="button" variant="primary" onClick={() => setCompleteOpen(true)}>
                  Completar
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {loadError ? <ErrorState title="No pudimos cargar la orden" body={loadError} onRetry={load} /> : null}
        {!context && !loadError ? <Skeleton rows={4} /> : null}
        {context ? (
          <div className={styles.body}>
            <div className={styles.idLine}>
              <IdTag id={context.workOrder.id} />
              {context.blueprints.map((blueprint) => (
                <IdTag key={blueprint.id} id={blueprint.id} />
              ))}
            </div>

            <div className={styles.statusLine}>
              {status ? <StatusBadge kind="workOrder" status={status} /> : null}
              <span className={styles.assignee}>
                {context.workOrder.assignedTo ? (
                  <>
                    Asignada a <span className="id">{context.workOrder.assignedTo}</span>
                  </>
                ) : (
                  'Sin asignar'
                )}
              </span>
            </div>

            {context.drift.length > 0 ? (
              <div className={styles.driftBox}>
                <Severity severity="error" />
                <span>Esta orden quedó fuera de sincronía: revisá los criterios antes de retomarla.</span>
              </div>
            ) : null}

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Objetivo</h3>
              <p className={styles.objective}>{context.workOrder.body}</p>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Criterios de aceptación</h3>
              {context.workOrder.acceptanceCriteria.length === 0 ? (
                <p className={styles.empty}>Esta orden no tiene criterios de aceptación explícitos.</p>
              ) : (
                <ul className={styles.criteria}>
                  {context.workOrder.acceptanceCriteria.map((criterion) => (
                    <li key={criterion}>{criterion}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Código gobernado</h3>
              {context.code.length === 0 ? (
                <p className={styles.empty}>Todavía no hay código gobernado para esta orden.</p>
              ) : (
                <ul className={styles.paths}>
                  {context.code.map((ref) => (
                    <li key={ref.key} className={styles.pathRow}>
                      <span className={`id ${styles.pathText}`}>{ref.path}</span>
                      <span className={[styles.pathStatus, ref.status === 'out_of_sync' ? styles.pathOutOfSync : styles.pathSynced].join(' ')}>
                        {ref.status === 'out_of_sync' ? 'Fuera de sincronía' : 'Sincronizado'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Commits</h3>
              {context.commits.length === 0 ? (
                <p className={styles.empty}>Todavía no hay commits para esta orden.</p>
              ) : (
                <ul className={styles.commits}>
                  {context.commits.map((commit) => (
                    <li key={commit.sha} className={styles.commitRow}>
                      <span className="id">{commit.sha.slice(0, 12)}</span>
                      <span>{commit.subject}</span>
                      <span className={styles.commitMeta}>
                        <span className="id">{commit.author}</span> · {commit.date}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </Drawer>

      <CompleteOrderModal
        open={completeOpen}
        workOrderId={workOrderId}
        submitting={completing}
        error={completeError}
        onClose={() => {
          setCompleteOpen(false);
          setCompleteError(null);
        }}
        onConfirm={(sha) => void handleComplete(sha)}
      />
    </>
  );
}
