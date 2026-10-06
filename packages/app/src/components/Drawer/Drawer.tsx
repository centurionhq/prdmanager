import { X } from 'lucide-react';
import { useId, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { useDialogController, useScrimClose } from '../../lib/use-dialog-controller';
import styles from './Drawer.module.css';

export interface DrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: number;
}

/** Right-side panel, full screen under 640px. See the "Resumen del importador" aside on Ordenes.dc.html. */
export function Drawer({ open, title, onClose, children, footer, width = 440 }: DrawerProps): ReactElement {
  const { dialogRef } = useDialogController({ open, onClose });
  const scrim = useScrimClose(onClose);
  const titleId = useId();

  const panelStyle = { '--drawer-width': `${width}px` } as CSSProperties;

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      className={styles.dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={scrim.onMouseDown}
      onClick={scrim.onClick}
    >
      <div className={styles.panel} style={panelStyle}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" aria-label="Cerrar" className={styles.close} onClick={onClose}>
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        {/* WO-669, scrollable-region-focusable (WCAG 2.1.1): el cuerpo puede desbordar y tiene que poder scrollearse con el teclado. */}
        <div className={styles.body} tabIndex={0}>
          {children}
        </div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </dialog>
  );
}
