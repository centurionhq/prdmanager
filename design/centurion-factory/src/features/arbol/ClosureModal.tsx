import { Check, X } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router';
import { Button, Modal, useToast } from '../../components';
import type { Feature } from '../../data';
import { computeClosureReadiness, passSummary, type ClosureCheckDisplay } from './closure';
import styles from './ClosureModal.module.css';

export interface ClosureModalProps {
  readonly feature: Feature;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called once the feature actually closes, so the caller can update its local state. */
  readonly onClosed: (featureId: string) => void;
}

function CheckRow({ check }: { readonly check: ClosureCheckDisplay }): ReactElement {
  return (
    <div className={styles.row}>
      {check.ok ? (
        <Check aria-hidden="true" size={20} strokeWidth={2} className={styles.iconOk} />
      ) : (
        <X aria-hidden="true" size={20} strokeWidth={2} className={styles.iconFail} />
      )}
      <div className={styles.labelBlock}>
        <span className={[styles.label, check.ok ? null : styles.labelFail].filter(Boolean).join(' ')}>{check.label}</span>
        <span className={['id', styles.technicalName].join(' ')}>{check.name}</span>
      </div>
      <div className={[styles.detail, check.ok ? null : styles.detailFail].filter(Boolean).join(' ')}>
        {check.detail}
        {check.name === 'project_clean' && !check.ok ? (
          <>
            {' '}
            <Link to="/drift">Ir a Drift</Link>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "Cerrar feature" modal (WO-285): recomputes closureReadiness for `feature` and, once all five
 * checks pass, closes the feature in local state and raises the "Feature cerrada" toast.
 */
export function ClosureModal({ feature, open, onClose, onClosed }: ClosureModalProps): ReactElement {
  const { show } = useToast();
  const result = useMemo(() => computeClosureReadiness(feature), [feature]);
  const alreadyClosed = feature.status === 'closed';

  function handleCloseFeature(): void {
    if (!result.ready) return;
    onClosed(feature.id);
    show('Feature cerrada', { tone: 'success' });
    onClose();
  }

  const footer = alreadyClosed ? null : (
    <div className={styles.footerRow}>
      <span className={styles.helper}>{result.ready ? null : 'Se habilita cuando pasan los cinco checks'}</span>
      <div className={styles.footerButtons}>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="button" variant="primary" disabled={!result.ready} onClick={handleCloseFeature}>
          Cerrar feature
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cerrar feature"
      description={`${feature.id} ${feature.title}`}
      footer={footer}
    >
      {alreadyClosed ? (
        <p>Esta feature ya está cerrada.</p>
      ) : (
        <div className={styles.checklist}>
          <div className={styles.summary}>{passSummary(result.checks)}</div>
          {result.checks.map((check) => (
            <CheckRow key={check.name} check={check} />
          ))}
        </div>
      )}
    </Modal>
  );
}
