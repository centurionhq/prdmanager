import type { ReactElement, ReactNode } from 'react';
import styles from './SettingsSection.module.css';

export interface SettingsSectionProps {
  readonly title: string;
  readonly description: ReactNode;
  readonly children: ReactNode;
}

/**
 * One row of a settings panel (canvas `AjustesGeneral.dc.html`): title and one-line description on the left, the
 * group's controls on the right; a single column under 767 px. The title is an `h3` -- the screen's own
 * `SectionHeader` already owns the `h2`.
 */
export function SettingsSection({ title, description, children }: SettingsSectionProps): ReactElement {
  return (
    <section className={styles.section}>
      <div className={styles.intro}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.description}>{description}</p>
      </div>
      <div className={styles.controls}>{children}</div>
    </section>
  );
}
