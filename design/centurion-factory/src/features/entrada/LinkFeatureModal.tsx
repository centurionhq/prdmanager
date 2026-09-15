import { useEffect, useId, useState, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { InboxItem } from '../../data';
import styles from './EntradaModals.module.css';
import { formatScore, rankCandidates } from './lib';

export interface LinkFeatureModalProps {
  readonly open: boolean;
  readonly item: InboxItem | undefined;
  readonly onClose: () => void;
  readonly onConfirm: (featureId: string) => void;
}

/** "Enlazar a feature": candidates as radio options, the best match preselected (WO-295). */
export function LinkFeatureModal({ open, item, onClose, onConfirm }: LinkFeatureModalProps): ReactElement | null {
  const groupName = useId();
  const candidates = item ? rankCandidates(item) : [];
  const [selected, setSelected] = useState<string | undefined>(candidates[0]?.featureId);

  useEffect(() => {
    setSelected(candidates[0]?.featureId);
    // Candidates only change when the item being linked changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enlazar a feature"
      description={`${item.id} ${item.title}`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          {candidates.length > 0 ? (
            <Button type="button" variant="primary" disabled={!selected} onClick={() => selected && onConfirm(selected)}>
              Enlazar
            </Button>
          ) : null}
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className={styles.empty}>Todavía no hay candidatas sugeridas para este feedback.</p>
      ) : (
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
                  {candidate.reason}
                  {candidate.isBestMatch ? <span className={styles.bestMatch}> Mejor coincidencia</span> : null}
                </span>
                <span className="num">{formatScore(candidate.score)}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
