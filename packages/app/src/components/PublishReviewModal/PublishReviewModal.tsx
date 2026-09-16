/**
 * "Revisar antes de publicar" (SDD-013 §"Documentos", WO-357, `DocumentoRevision.dc.html`): frozen
 * frontmatter/`## Tareas` diff against the currently published version, `impacts_paths` called out, the
 * frontmatter keys that changed, and a "qué va a pasar" summary — confirming here is the only thing that
 * actually calls `onConfirm` (the real publish); closing never does.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { DocumentKind, DocumentVersionListItem, DocumentVersionSummary, ValidationIssueSummary } from '@prdm/contracts';
import { getDocumentVersionDiff, listDocumentVersions } from '../../api/versions.js';
import { errorMessage } from '../../api/error-message.js';
import { diffFrontmatterKeys, extractTaskLines, summarizePublishDiff, type PublishDiffSummary } from '../../lib/publish-review.js';
import { Button } from '../Button/Button.js';
import { Modal } from '../Modal/Modal.js';
import styles from './PublishReviewModal.module.css';

export interface PublishReviewModalProps {
  readonly open: boolean;
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly docId: string;
  readonly kind: DocumentKind;
  readonly currentVersion: DocumentVersionSummary;
  readonly publishedVersionId: string | null;
  readonly validation: readonly ValidationIssueSummary[] | null;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

const GENERATES_WORK_ORDERS_KINDS: readonly DocumentKind[] = ['SDD', 'ADR'];

interface LoadedReview {
  readonly previousVersion: DocumentVersionListItem | null;
  readonly diff: PublishDiffSummary | null;
  readonly fallbackTasks: readonly string[];
  readonly frontmatterKeyChanges: ReturnType<typeof diffFrontmatterKeys>;
}

function DiffLines({ ops }: { readonly ops: readonly { type: string; line: string }[] }): ReactElement {
  return (
    <div className={styles.diffBlock}>
      {ops.map((op, index) => (
        <div key={index} className={op.type === 'added' ? styles.diffAdded : styles.diffRemoved}>
          <span aria-hidden="true">{op.type === 'added' ? '+' : '−'}</span>
          <span>{op.line}</span>
        </div>
      ))}
    </div>
  );
}

export function PublishReviewModal({
  open,
  orgSlug,
  projectSlug,
  docId,
  kind,
  currentVersion,
  publishedVersionId,
  validation,
  busy,
  onClose,
  onConfirm,
}: PublishReviewModalProps): ReactElement {
  const [review, setReview] = useState<LoadedReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReview(null);
    setLoadError(null);

    if (!publishedVersionId) {
      setReview({ previousVersion: null, diff: null, fallbackTasks: extractTaskLines(currentVersion.renderedMarkdown), frontmatterKeyChanges: [] });
      return;
    }

    listDocumentVersions(orgSlug, projectSlug, docId, { limit: 200 })
      .then((page) => {
        const previousVersion = page.versions.find((v) => v.id === publishedVersionId) ?? null;
        if (!previousVersion || previousVersion.versionNo === currentVersion.versionNo) {
          setReview({ previousVersion, diff: null, fallbackTasks: extractTaskLines(currentVersion.renderedMarkdown), frontmatterKeyChanges: [] });
          return;
        }
        return getDocumentVersionDiff(orgSlug, projectSlug, docId, currentVersion.versionNo, previousVersion.versionNo).then((result) => {
          setReview({
            previousVersion,
            diff: summarizePublishDiff(result.diff),
            fallbackTasks: [],
            frontmatterKeyChanges: diffFrontmatterKeys(previousVersion.frontmatter, currentVersion.frontmatter),
          });
        });
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }, [open, orgSlug, projectSlug, docId, publishedVersionId, currentVersion]);

  const errors = validation?.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = validation?.filter((issue) => issue.severity === 'warning') ?? [];
  const newTaskCount = review?.diff?.newTaskCount ?? review?.fallbackTasks.length ?? 0;
  const generatesWorkOrders = GENERATES_WORK_ORDERS_KINDS.includes(kind);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Revisar antes de publicar"
      description={`Congelás la versión ${currentVersion.versionNo} en el estado en que está ahora. Publicar la vuelve la copia oficial que leen los developers.`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver a editar
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={onConfirm}>
            {`Publicar versión ${currentVersion.versionNo}`}
          </Button>
        </>
      }
    >
      {loadError && (
        <p role="alert" className={styles.loadError}>
          No pudimos calcular la comparación con la versión publicada: {loadError}
        </p>
      )}

      {!review && !loadError && <p className={styles.loading}>Calculando cambios…</p>}

      {review && (
        <div className={styles.grid}>
          <div className={styles.main}>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Frontmatter</h3>
              {review.diff && review.diff.frontmatter.length > 0 ? (
                <DiffLines ops={review.diff.frontmatter} />
              ) : (
                <p className={styles.hint}>Sin cambios de frontmatter.</p>
              )}
              {review.diff?.impactsPathsChanged && (
                <p role="alert" className={styles.impactsWarning}>
                  <strong>impacts_paths cambió.</strong> Vuelve a hashear el gobierno de este documento; cualquier orden de trabajo abierta contra la
                  versión anterior queda fuera de sincronía y hay que reconciliarla.
                </p>
              )}
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>## Tareas</h3>
              {review.diff && review.diff.tasks.length > 0 ? (
                <DiffLines ops={review.diff.tasks} />
              ) : review.fallbackTasks.length > 0 ? (
                <DiffLines ops={review.fallbackTasks.map((line) => ({ type: 'added', line }))} />
              ) : (
                <p className={styles.hint}>Sin tareas nuevas.</p>
              )}
              {generatesWorkOrders && (
                <p className={styles.hint}>
                  {newTaskCount} tarea{newTaskCount === 1 ? '' : 's'} nueva{newTaskCount === 1 ? '' : 's'} {newTaskCount === 1 ? 'va' : 'van'} a generar {newTaskCount}{' '}
                  orden
                  {newTaskCount === 1 ? '' : 'es'} de trabajo al publicar.
                </p>
              )}
            </section>

            {review.frontmatterKeyChanges.length > 0 && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Links y campos agregados desde la versión publicada</h3>
                <ul className={styles.linksList}>
                  {review.frontmatterKeyChanges.map((change) => (
                    <li key={change.key} className={styles.linksItem}>
                      <code>{change.key}</code>
                      <span>
                        {change.before ?? '—'} → {change.after ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className={styles.aside}>
            <div className={styles.card}>
              <h3 className={styles.sectionTitle}>Qué va a pasar</h3>
              <ul className={styles.bulletList}>
                <li>El estado pasa a <strong>published</strong></li>
                <li>
                  Se congela la versión {currentVersion.versionNo}, motivo <code>published</code>
                </li>
                {generatesWorkOrders && (
                  <li>
                    Se generan {newTaskCount} orden{newTaskCount === 1 ? '' : 'es'} de trabajo nueva{newTaskCount === 1 ? '' : 's'}
                  </li>
                )}
                <li>Los developers ven esta versión por MCP a partir de ahora</li>
              </ul>
            </div>

            <div className={styles.card}>
              <h3 className={styles.sectionTitle}>Validación</h3>
              {errors.length === 0 && warnings.length === 0 ? (
                <p className={styles.ok}>0 errores, 0 avisos</p>
              ) : (
                <p className={errors.length > 0 ? styles.validationError : styles.ok}>
                  {errors.length} error{errors.length === 1 ? '' : 'es'}, {warnings.length} aviso{warnings.length === 1 ? '' : 's'}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </Modal>
  );
}
