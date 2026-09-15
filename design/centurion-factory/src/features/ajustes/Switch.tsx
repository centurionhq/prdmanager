import type { ReactElement } from 'react';
import styles from './SsoPage.module.css';

export interface SwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}

/** A real `role="switch"` toggle, 40×24 track with an 18px knob (WO-307). */
export function Switch({ label, checked, onChange }: SwitchProps): ReactElement {
  return (
    <button type="button" role="switch" aria-checked={checked} className={styles.switchRow} onClick={onChange}>
      <span className={`${styles.track} ${checked ? styles.trackOn : ''}`}>
        <span className={`${styles.knob} ${checked ? styles.knobOn : ''}`} />
      </span>
      <span className={styles.switchLabel}>{label}</span>
    </button>
  );
}
