/**
 * `ConfirmDialog` (SDD-062, `ConfirmDialog.dc.html`): the design system's confirmation dialog for the
 * destructive actions of Ajustes — revoking a token, removing a member, revoking an invitation.
 *
 * It is built on the barrel `Modal` (Esc, scrim and focus return already live in `useDialogController`),
 * so this component only owns what the decision needs: the resource being touched, the consequence, the
 * focus on the safe exit, and the three states of a mutation — idle, in flight (nothing closes, both
 * buttons off) and failed (the message stays inside the dialog and the action turns into "Reintentar").
 * There is no undo: this dialog is the only net, so it never invents copy — `title`, `description`,
 * `confirmLabel` and `error` come from the screen.
 */
import { CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogResource {
  readonly name: string;
  readonly meta?: string;
}

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly resource?: ConfirmDialogResource;
  readonly confirmLabel: string;
  readonly busyLabel?: string;
  readonly error?: string | null;
  readonly pending?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  resource,
  confirmLabel,
  busyLabel,
  error,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  const footerRef = useRef<HTMLDivElement>(null);

  // Esc, the X and the scrim all land here: a mutation in flight is never cancelled by closing the dialog.
  const handleClose = useCallback(() => {
    if (!pending) onCancel();
  }, [pending, onCancel]);

  // The initial focus goes to the safe exit, never to the destructive action. `Button` does not forward
  // refs, and the footer starts with "Cancelar", so the first button of the footer is it.
  useEffect(() => {
    if (!open) return;
    footerRef.current?.querySelector('button')?.focus();
  }, [open]);

  const actionLabel = pending ? (busyLabel ?? confirmLabel) : error ? 'Reintentar' : confirmLabel;

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={handleClose}
      footer={
        <div ref={footerRef} className={styles.footer}>
          <Button type="button" variant="secondary" className={styles.button} disabled={pending} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" className={styles.button} disabled={pending} onClick={onConfirm}>
            {pending ? <span className={styles.spinner} aria-hidden="true" /> : null}
            {actionLabel}
          </Button>
        </div>
      }
    >
      <div className={styles.scroll}>
        {resource ? (
          <div className={styles.resource}>
            <span className={styles.resourceName}>{resource.name}</span>
            {resource.meta ? <span className={styles.resourceMeta}>{resource.meta}</span> : null}
          </div>
        ) : null}

        {pending ? (
          <span className={styles.progress} aria-live="polite">
            {`${busyLabel ?? confirmLabel}…`}
          </span>
        ) : null}

        {error && !pending ? (
          <p role="alert" className={styles.error}>
            <CircleAlert aria-hidden="true" size={16} className={styles.errorIcon} />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
