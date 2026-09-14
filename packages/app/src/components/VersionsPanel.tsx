/**
 * Versions panel (SDD-008 §"Versiones", WO-163): list from WO-156's endpoint (version_no, label, reason,
 * contributors, created_at), select two to diff (rendered inline, added/removed lines), and a
 * "Restaurar" button (editor+, `restore_version`) confirming then calling WO-157's endpoint.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { can, type DocumentVersionSummary, type PermissionSubject } from '@prdm/contracts';
import { getDocumentVersionDiff, listDocumentVersions, restoreDocumentVersion, saveDocumentVersion, type DocumentVersionDiff } from '../api/versions.js';
import { useCollabDocumentContext } from '../collab/collab-document-context.js';
import { errorMessage } from '../api/error-message.js';
import styles from '../styles/versions-panel.module.css';

export interface VersionsPanelProps {
  subject: PermissionSubject;
}

const REASON_LABEL: Record<DocumentVersionSummary['reason'], string> = {
  manual: 'Manual',
  review_request: 'Solicitud de revisión',
  published: 'Publicación',
  agent_accept: 'Propuesta de agente aceptada',
  restore: 'Restauración',
  engine_write: 'Escritura del motor',
  import: 'Importación',
};

export function VersionsPanel({ subject }: VersionsPanelProps): ReactElement {
  const { orgSlug, projectSlug, docId } = useCollabDocumentContext();
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [diff, setDiff] = useState<DocumentVersionDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState<number | null>(null);

  function reload(): void {
    listDocumentVersions(orgSlug, projectSlug, docId)
      .then(setVersions)
      .catch((err: unknown) => setError(errorMessage(err)));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, projectSlug, docId]);
  // No dedicated "version created" stateless broadcast exists (unlike blame/validation/comments) —
  // this panel's own save/restore actions reload() directly after succeeding instead; a version created
  // by someone else's request-review/publish in another tab simply isn't live-refreshed here yet.

  function toggleSelect(versionNo: number): void {
    setDiff(null);
    setSelected((prev) => {
      if (!prev) return [versionNo, versionNo];
      const [a] = prev;
      return a === versionNo ? prev : [a, versionNo];
    });
  }

  async function handleShowDiff(): Promise<void> {
    if (!selected) return;
    const [a, b] = selected;
    if (a === b) return;
    try {
      setDiff(await getDocumentVersionDiff(orgSlug, projectSlug, docId, Math.max(a, b), Math.min(a, b)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await saveDocumentVersion(orgSlug, projectSlug, docId, label.trim());
      setLabel('');
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(versionNo: number): Promise<void> {
    setBusy(true);
    try {
      await restoreDocumentVersion(orgSlug, projectSlug, docId, versionNo);
      setConfirmingRestore(null);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const canEdit = can(subject, 'edit_document');
  const canRestore = can(subject, 'restore_version');

  return (
    <section className={styles.panel} aria-label="Versiones">
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {canEdit && (
        <form className={styles.saveForm} onSubmit={(e) => void handleSave(e)}>
          <input
            type="text"
            className={styles.input}
            placeholder="Etiqueta de la versión"
            aria-label="Etiqueta de la versión"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" className={styles.smallButton} disabled={busy || !label.trim()}>
            Guardar versión
          </button>
        </form>
      )}

      <ul className={styles.list}>
        {versions.map((version) => (
          <li key={version.id} className={styles.item}>
            <label className={styles.itemLabel}>
              <input type="checkbox" checked={selected?.includes(version.versionNo) ?? false} onChange={() => toggleSelect(version.versionNo)} />
              <span>
                v{version.versionNo} · {version.label ?? REASON_LABEL[version.reason]}
              </span>
            </label>
            <span className={styles.meta}>
              {REASON_LABEL[version.reason]} · {new Date(version.createdAt).toLocaleString()} · {version.contributors.join(', ') || 'sin contribuyentes'}
            </span>
            {canRestore &&
              (confirmingRestore === version.versionNo ? (
                <span className={styles.confirmRow}>
                  <button type="button" className={styles.smallButton} disabled={busy} onClick={() => void handleRestore(version.versionNo)}>
                    Confirmar restauración
                  </button>
                  <button type="button" className={styles.linkButton} onClick={() => setConfirmingRestore(null)}>
                    Cancelar
                  </button>
                </span>
              ) : (
                <button type="button" className={styles.linkButton} onClick={() => setConfirmingRestore(version.versionNo)}>
                  Restaurar
                </button>
              ))}
          </li>
        ))}
        {versions.length === 0 && <li className={styles.empty}>Sin versiones todavía.</li>}
      </ul>

      {selected && selected[0] !== selected[1] && (
        <button type="button" className={styles.smallButton} onClick={() => void handleShowDiff()}>
          Comparar v{Math.min(...selected)} → v{Math.max(...selected)}
        </button>
      )}

      {diff && (
        <pre className={styles.diff} aria-label={`Diferencias entre la versión ${diff.from.versionNo} y la ${diff.to.versionNo}`}>
          {diff.diff.map((op, i) => (
            <div key={i} className={op.type === 'added' ? styles.diffAdded : op.type === 'removed' ? styles.diffRemoved : styles.diffEqual}>
              {op.type === 'added' ? '+ ' : op.type === 'removed' ? '- ' : '  '}
              {op.line}
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}
