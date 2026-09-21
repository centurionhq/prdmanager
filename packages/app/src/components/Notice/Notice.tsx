import type { ReactElement, ReactNode } from 'react';
import styles from './Notice.module.css';

export interface NoticeProps {
  readonly children: ReactNode;
}

/** A short statement the screen owes the person (no permission, nothing to show yet): a callout, not an error. */
export function Notice({ children }: NoticeProps): ReactElement {
  return <p className={styles.notice}>{children}</p>;
}
