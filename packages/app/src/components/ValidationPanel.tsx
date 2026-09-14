/**
 * Validation panel (SDD-008 §"Validación en vivo", WO-164): shows WO-155's `last_validation` issues
 * grouped by severity, refetched live on every `validation:updated` stateless broadcast (no HTTP
 * round-trip needed — the broadcast payload already carries the issues), and the workflow-state action
 * buttons (Solicitar revisión / Publicar / Archivar — "Volver a borrador" has no server-side transition
 * to call yet, WO-136/137 never exposed one) gated by `can(subject, action)`, disabled with a tooltip
 * explaining why when blocked by a pending error-severity issue.
 *
 * These are the *same* actions `DocumentDetail`'s own top-level action bar exposes for non-collab-origin
 * documents — for a `collab`-origin document, `DocumentDetail` hides that bar and renders this panel
 * instead, so the buttons only ever appear once per page.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { can, type PermissionSubject, type ValidationIssueSummary } from '@prdm/contracts';
import { useCollabDocumentContext } from '../collab/collab-document-context.js';
import { useStatelessMessage } from '../collab/use-stateless-message.js';
import styles from '../styles/validation-panel.module.css';

export interface ValidationPanelProps {
  subject: PermissionSubject;
  initialIssues: ValidationIssueSummary[] | null;
  canRequestReview: boolean;
  canPublish: boolean;
  canArchive: boolean;
  busy: boolean;
  onRequestReview: () => void;
  onPublish: () => void;
  onArchive: () => void;
}

const SEVERITY_LABEL: Record<ValidationIssueSummary['severity'], string> = { error: 'Errores', warning: 'Advertencias' };

interface ValidationUpdatedPayload {
  type: 'validation:updated';
  issues: ValidationIssueSummary[];
}

export function ValidationPanel({ subject, initialIssues, canRequestReview, canPublish, canArchive, busy, onRequestReview, onPublish, onArchive }: ValidationPanelProps): ReactElement {
  const { provider } = useCollabDocumentContext();
  const [issues, setIssues] = useState<ValidationIssueSummary[] | null>(initialIssues);

  useEffect(() => setIssues(initialIssues), [initialIssues]);
  useStatelessMessage<ValidationUpdatedPayload>(provider, 'validation:updated', (payload) => setIssues(payload.issues));

  const errors = issues?.filter((i) => i.severity === 'error') ?? [];
  const warnings = issues?.filter((i) => i.severity === 'warning') ?? [];
  const hasBlockingErrors = errors.length > 0;
  const publishBlockedTooltip = hasBlockingErrors ? 'hay errores de validación bloqueantes' : undefined;

  return (
    <section className={styles.panel} aria-label="Validación">
      {errors.length === 0 && warnings.length === 0 && <p className={styles.ok}>Sin problemas de validación.</p>}

      {(['error', 'warning'] as const).map((severity) => {
        const group = severity === 'error' ? errors : warnings;
        if (group.length === 0) return null;
        return (
          <div key={severity} className={styles.group}>
            <h3 className={severity === 'error' ? styles.groupTitleError : styles.groupTitleWarning}>
              {SEVERITY_LABEL[severity]} ({group.length})
            </h3>
            <ul className={styles.issueList}>
              {group.map((issue, i) => (
                <li key={i} className={styles.issue}>
                  {issue.field && <code className={styles.field}>{issue.field}</code>} {issue.message}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <div className={styles.actions}>
        {canRequestReview && can(subject, 'request_review') && (
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={onRequestReview}>
            Solicitar revisión
          </button>
        )}
        {canPublish && can(subject, 'publish') && (
          <span className={styles.actionWithHint}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy || hasBlockingErrors}
              title={publishBlockedTooltip}
              aria-describedby={hasBlockingErrors ? 'publish-blocked-reason' : undefined}
              onClick={onPublish}
            >
              Publicar
            </button>
            {/* Visible, not just a hover `title` a screen reader/keyboard-only user would never see — the
                button's own `aria-describedby` points here when disabled for this reason. */}
            {hasBlockingErrors && (
              <span id="publish-blocked-reason" className={styles.hint}>
                {publishBlockedTooltip}
              </span>
            )}
          </span>
        )}
        {canArchive && can(subject, 'archive') && (
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={onArchive}>
            Archivar
          </button>
        )}
      </div>
    </section>
  );
}
