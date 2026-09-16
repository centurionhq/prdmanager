import { X } from 'lucide-react';
import { useId, type ReactElement, type ReactNode } from 'react';
import { useDialogController, useScrimClose } from '../../lib/use-dialog-controller';
import styles from './Modal.module.css';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly size?: ModalSize;
}

const SIZE_CLASS: Record<ModalSize, string | undefined> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
};

/** Centered dialog, 520px wide by default. See the "Reconocer drift" plate on Drift.dc.html. */
export function Modal({ open, title, description, onClose, children, footer, size = 'md' }: ModalProps): ReactElement {
  const { dialogRef } = useDialogController({ open, onClose });
  const scrim = useScrimClose(onClose);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onMouseDown={scrim.onMouseDown}
      onClick={scrim.onClick}
    >
      <div className={[styles.panel, SIZE_CLASS[size]].filter((value): value is string => Boolean(value)).join(' ')}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" aria-label="Cerrar" className={styles.close} onClick={onClose}>
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        {description ? (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        ) : null}
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </dialog>
  );
}
