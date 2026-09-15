import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: ReactNode;
  /** Breadcrumb or context line above the title. */
  readonly eyebrow?: ReactNode;
  readonly actions?: ReactNode;
}

/** Screen header from the approved canvas: 44px Archivo 800 title, muted subtitle, actions on the right. */
export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
