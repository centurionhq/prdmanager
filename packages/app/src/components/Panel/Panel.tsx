import type { ReactElement, ReactNode } from 'react';
import styles from './Panel.module.css';

export interface PanelProps {
  readonly children: ReactNode;
}

/** The surface a form or a block of settings sits on (SDD-056/PRD-036 R2): one bordered plate, one padding. */
export function Panel({ children }: PanelProps): ReactElement {
  return <div className={styles.panel}>{children}</div>;
}
