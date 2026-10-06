import type { ReactElement, ReactNode } from 'react';
import styles from './SectionHeader.module.css';

export interface SectionHeaderProps {
  readonly title: string;
  readonly subtitle?: ReactNode;
  /** The section's primary action, drawn beside the title (canvas `AjustesTokens.dc.html`: "Crear token"). */
  readonly actions?: ReactNode;
}

/**
 * The title block of a screen *inside* a section (SDD-056/PRD-036 R2): a level-two heading, one sentence under
 * it, and the section's primary action on the right. `PageHeader` owns the page's single `h1`; this is what sits
 * under it, so every screen of a section opens the same way instead of each choosing its own type scale.
 */
export function SectionHeader({ title, subtitle, actions }: SectionHeaderProps): ReactElement {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        <h2 className={styles.title}>{title}</h2>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
