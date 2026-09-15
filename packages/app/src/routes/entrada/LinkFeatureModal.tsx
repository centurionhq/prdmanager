/** "Enlazar a feature" (SDD-013, WO-362): fetches this item's real candidates (`getFeedbackCandidates`)
 * and links it to the chosen one (`triageFeedback`). A 409 `pending_republish` (the target document has
 * a live collaborative working copy) is explained, not treated as an error — the link takes effect once
 * that document is next republished. */
import { useEffect, useId, useState, type ReactElement } from 'react';
import type { CandidateDto, InboxItemDto } from '@prdm/contracts';
import { ApiClientError, getFeedbackCandidates, triageFeedback } from '../../api/client.js';
import { errorMessage } from '../../api/error-message.js';
import { Button, ErrorState, Modal, Skeleton } from '../../components/index.js';
import styles from './LinkFeatureModal.module.css';

const REASON_LABEL: Record<CandidateDto['reason'], string> = {
  mention: 'menciona esta feature',
  score: 'coincide por puntaje',
  none: '',
};

export interface LinkFeatureModalProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly item: InboxItemDto | undefined;
  readonly onClose: () => void;
  readonly onLinked: (featureId: string) => void;
}

export function LinkFeatureModal({ orgSlug, projectSlug, item, onClose, onLinked }: LinkFeatureModalProps): ReactElement {
  const groupName = useId();
  const [candidates, setCandidates] = useState<CandidateDto[] | null>(null);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingRepublish, setPendingRepublish] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function load(): void {
    if (!item) return;
    setCandidates(null);
    setLoadError(null);
    getFeedbackCandidates(orgSlug, projectSlug, item.id)
      .then((result) => {
        setCandidates(result);
        setSelected(result[0]?.featureId);
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }

  useEffect(() => {
    setPendingRepublish(false);
    setSubmitError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads only when the target item changes.
  }, [item?.id]);

  async function handleConfirm(): Promise<void> {
    if (!item || !selected) return;
    setSubmitting(true);
    setSubmitError(null);
    setPendingRepublish(false);
    try {
      await triageFeedback(orgSlug, projectSlug, item.id, { linkTo: [selected] });
      onLinked(selected);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setPendingRepublish(true);
      } else {
        setSubmitError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      title="Enlazar a feature"
      description={item ? `${item.id} ${item.title}` : undefined}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          {candidates && candidates.length > 0 ? (
            <Button type="button" variant="primary" disabled={!selected || submitting} onClick={() => void handleConfirm()}>
              Enlazar
            </Button>
          ) : null}
        </>
      }
    >
      {loadError ? <ErrorState title="No pudimos cargar las candidatas" body={loadError} onRetry={load} /> : null}
      {!candidates && !loadError ? <Skeleton rows={3} /> : null}
      {candidates && candidates.length === 0 ? <p className={styles.empty}>Todavía no hay candidatas sugeridas para este feedback.</p> : null}
      {candidates && candidates.length > 0 ? (
        <div role="radiogroup" aria-label="Candidatas" className={styles.candidateList}>
          {candidates.map((candidate) => (
            <label key={candidate.featureId} className={styles.candidateOption}>
              <input
                type="radio"
                name={groupName}
                value={candidate.featureId}
                checked={selected === candidate.featureId}
                onChange={() => setSelected(candidate.featureId)}
              />
              <span className={styles.candidateInfo}>
                <span className="id">{candidate.featureId}</span>
                <span className={styles.candidateReason}>
                  {REASON_LABEL[candidate.reason]}
                  {candidate === candidates[0] ? <span className={styles.bestMatch}>Mejor coincidencia</span> : null}
                </span>
                <span className="num">{candidate.score.toFixed(2)}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {pendingRepublish ? (
        <p className={styles.pendingRepublish} role="alert">
          {item?.id} tiene una copia de trabajo colaborativa activa: el enlace se va a aplicar recién cuando se republique el documento.
        </p>
      ) : null}
      {submitError ? (
        <p className={styles.pendingRepublish} role="alert">
          {submitError}
        </p>
      ) : null}
    </Modal>
  );
}
