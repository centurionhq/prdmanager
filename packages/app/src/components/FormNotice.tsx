import type { ReactElement } from 'react';
import styles from '../styles/forms.module.css';

export interface FormNoticeProps {
  readonly title: string;
  readonly subtitle: string;
}

/** The full-page "title + one line of explanation" card every not-found/empty redirect screen used its
 * own copy of (`NotFound`, `OrgShell`, `ProjectShell`, `SettingsTokensRedirect`, `RootRedirect`) — same
 * `forms.module.css` page/card frame `FormError` already shares across every auth screen. */
export function FormNotice({ title, subtitle }: FormNoticeProps): ReactElement {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
    </div>
  );
}
