/** "Reconocer drift" (SDD-013, WO-361 · SDD-111, WO-765): picks one document (or the whole project) and
 * advances its baseline via `acknowledgeDrift`. The engine moves the baseline of a DOCUMENT, never of a single
 * issue, so the modal says how much the chosen target moves before confirming: the document's total debt, the
 * part of it the acknowledge actually resolves, and — for the project-wide target — how many documents advance
 * and an explicit checkbox (SDD-111 A1/A4). The same modal is opened from the header, from a subgroup and from
 * a row; `initialTarget` only chooses which option starts selected (SDD-111 D3). */
import { useEffect, useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal, ShaRef } from '../../components/index.js';
import { PROJECT_TARGET, type AcknowledgeTarget } from './drift-groups.js';
import styles from './AcknowledgeModal.module.css';

export interface AcknowledgeModalProps {
  readonly open: boolean;
  readonly targets: readonly AcknowledgeTarget[];
  /** Preselected target when the modal is opened from a row or a subgroup; the header opens the default. */
  readonly initialTarget?: string;
  /** Commit the baseline moves to, when the official report is known; named in the summary. */
  readonly commitSha?: string | null;
  /** `owner/repo`, only to link that commit; without it the sha is shown copy-only (ShaRef's rule). */
  readonly repository?: string | null;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (target: string) => void;
}

function issueNoun(count: number): string {
  return count === 1 ? 'issue' : 'issues';
}

/**
 * The second number of SDD-111 A1: acknowledging moves `baseline.docs[id]`/`governs[bp]`, which resolves the
 * code and finished-work-order issues but not the ones that depend on the graph or on a work order's state
 * (`core/src/sync/monitor.ts:215-229`). Saying only the total would promise more than the action delivers.
 */
function breakdownFor(count: number, resolvable: number): string {
  const remaining = count - resolvable;
  if (count === 0) return 'Este target no tiene issues en el reporte actual.';
  if (resolvable === 0) {
    return count === 1
      ? 'El único issue no se resuelve al reconocer: depende del grafo o del estado de una orden, no de la línea base (ciclo de vida, impacts_paths o ya aterrizadas).'
      : `Ninguno de los ${count} issues se resuelve al reconocer: dependen del grafo o del estado de una orden, no de la línea base (ciclo de vida, impacts_paths o ya aterrizadas).`;
  }
  if (remaining === 0) {
    return count === 1
      ? 'El único issue se resuelve al reconocer: es código u orden fuera de sincronía.'
      : `Los ${count} issues se resuelven al reconocer: son código y órdenes fuera de sincronía.`;
  }
  return `${resolvable} se ${resolvable === 1 ? 'resuelve' : 'resuelven'} al reconocer (código y órdenes fuera de sincronía); ${remaining} no ${remaining === 1 ? 'depende' : 'dependen'} de la línea base (ciclo de vida, impacts_paths o ya aterrizadas).`;
}

/** Names the document and how many issues it carries, then the A1 breakdown, in one sentence pair. */
function explanationFor(target: AcknowledgeTarget): string {
  const moved =
    target.count === 1
      ? 'se reconoce su único issue'
      : `se reconocen sus ${target.count} issues juntos`;
  const head =
    target.value === PROJECT_TARGET
      ? `Es el reconocimiento más amplio: avanza la línea base de ${target.documents === 1 ? 'el único documento' : `los ${target.documents} documentos`} del proyecto y ${moved}.`
      : `La línea base de ${target.value} avanza al último commit reportado: ${moved}.`;
  return `${head} ${breakdownFor(target.count, target.resolvable)}`;
}

/** The confirm button states the scope it is about to move, never a generic "Reconocer drift". */
function confirmLabelFor(target: AcknowledgeTarget): string {
  if (target.value === PROJECT_TARGET) return 'Reconocer todo el proyecto';
  return `Reconocer ${target.count} ${issueNoun(target.count)}`;
}

export function AcknowledgeModal({
  open,
  targets,
  initialTarget,
  commitSha,
  repository,
  submitting,
  onClose,
  onConfirm,
}: AcknowledgeModalProps): ReactElement {
  const [target, setTarget] = useState(initialTarget ?? targets[0]?.value ?? PROJECT_TARGET);
  const [understood, setUnderstood] = useState(false);
  const selectId = useId();
  const checkboxId = useId();

  // Re-sync every time the modal opens (or is opened for another row): the row and the subgroup both reuse it.
  // `targets` is rebuilt by the parent on each render, so it is deliberately not a dependency here.
  useEffect(() => {
    if (!open) return;
    setTarget(initialTarget ?? targets[0]?.value ?? PROJECT_TARGET);
    setUnderstood(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the opening (and who opened it) resets the form
  }, [open, initialTarget]);

  const current = targets.find((option) => option.value === target) ?? targets[0];
  const projectWide = current?.value === PROJECT_TARGET;
  const blocked = submitting || !current || (projectWide && !understood);

  // Nothing is mounted while the dialog is closed: a `<dialog>` without `open` keeps its subtree in the DOM,
  // and a stale summary (the commit sha, the counts of the previous open) would be readable — and matchable —
  // before anyone asked for it.
  return (
    <Modal
      open={open}
      title="Reconocer drift"
      onClose={onClose}
      footer={
        open ? (
          <div className={styles.footer}>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" disabled={blocked} onClick={() => current && onConfirm(current.value)}>
              {submitting ? 'Reconociendo…' : current ? confirmLabelFor(current) : 'Reconocer'}
            </Button>
          </div>
        ) : undefined
      }
    >
      {open ? (
        <>
          <div className={styles.field}>
            <label htmlFor={selectId} className={styles.label}>
              Qué reconocer
            </label>
            <select
              id={selectId}
              className={styles.select}
              value={current?.value ?? ''}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setTarget(event.target.value)}
            >
              {targets.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {current ? (
            <dl className={styles.summary}>
              <dt className={styles.summaryTerm}>{projectWide ? 'Alcance' : 'Documento'}</dt>
              <dd className={styles.summaryValue}>
                {projectWide ? 'Todo el proyecto' : <span className="id">{current.value}</span>}
              </dd>

              <dt className={styles.summaryTerm}>Issues que cubre</dt>
              <dd className={styles.summaryValue}>
                {current.count} {issueNoun(current.count)}
                {projectWide ? ` en ${current.documents} ${current.documents === 1 ? 'documento' : 'documentos'}` : null}
              </dd>

              <dt className={styles.summaryTerm}>Avanza al commit</dt>
              <dd className={styles.summaryValue}>
                {commitSha ? <ShaRef sha={commitSha} repository={repository} /> : 'el último commit reportado'}
              </dd>
            </dl>
          ) : null}

          {projectWide ? (
            <div className={styles.warning}>
              <p className={styles.warningText}>
                <strong>Es el reconocimiento más amplio.</strong> Si no revisaste todos, reconocelos de a uno.
              </p>
            </div>
          ) : null}

          {current ? <p className={styles.explanation}>{explanationFor(current)}</p> : null}

          {projectWide && current ? (
            <div className={styles.checkboxRow}>
              <input
                id={checkboxId}
                type="checkbox"
                className={styles.checkbox}
                checked={understood}
                onChange={(event) => setUnderstood(event.target.checked)}
              />
              <label htmlFor={checkboxId} className={styles.checkboxLabel}>
                Entiendo que avanza la línea base de todo el proyecto ({current.documents}{' '}
                {current.documents === 1 ? 'documento' : 'documentos'})
              </label>
            </div>
          ) : null}

          <p className={styles.audit}>Queda registrado en el historial de drift.</p>
        </>
      ) : null}
    </Modal>
  );
}
