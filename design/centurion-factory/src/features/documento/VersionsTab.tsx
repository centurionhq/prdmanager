/**
 * "Versiones" side panel tab (WO-290): the version history with number, reason, author and date.
 * "Restaurar" confirms in a Modal, then adds a `restore` version and toasts.
 */
import { useState, type ReactElement } from 'react';
import { Button, Modal, useToast } from '../../components';
import { getPerson, type DocumentVersion } from '../../data';
import { formatDateTimeEs } from '../../lib/format-date';
import { versionReasonLabel } from './labels';
import styles from './VersionsTab.module.css';

export interface VersionsTabProps {
  readonly versions: readonly DocumentVersion[];
  readonly onRestore: (versionNo: number) => string;
}

export function VersionsTab({ versions, onRestore }: VersionsTabProps): ReactElement {
  const { show } = useToast();
  const [pendingRestore, setPendingRestore] = useState<number | null>(null);
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);
  const latestNo = ordered[0]?.versionNo;

  function confirmRestore(): void {
    if (pendingRestore === null) return;
    const toast = onRestore(pendingRestore);
    setPendingRestore(null);
    show(toast);
  }

  return (
    <div className={styles.tab}>
      <ul className={styles.list}>
        {ordered.map((version) => (
          <li key={version.versionNo} className={styles.row}>
            <div className={styles.rowInfo}>
              <span className={styles.versionNo}>Versión {version.versionNo}</span>
              <span className={styles.reason}>{versionReasonLabel(version.reason)}</span>
              <span className={styles.meta}>
                {getPerson(version.createdBy)?.name ?? version.createdBy} · {formatDateTimeEs(version.createdAt)}
              </span>
            </div>
            {version.versionNo !== latestNo ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setPendingRestore(version.versionNo)}>
                Restaurar
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <Modal
        open={pendingRestore !== null}
        title="Restaurar versión"
        description={pendingRestore !== null ? `Vas a restaurar la versión ${pendingRestore}. Se crea una versión nueva; no se pierde nada.` : undefined}
        onClose={() => setPendingRestore(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPendingRestore(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" onClick={confirmRestore}>
              Restaurar
            </Button>
          </>
        }
      >
        <p>Podés seguir editando después: nada de la versión actual se descarta.</p>
      </Modal>
    </div>
  );
}
