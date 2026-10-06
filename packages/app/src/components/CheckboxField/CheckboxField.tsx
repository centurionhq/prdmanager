import { useId, type ReactElement, type ReactNode } from 'react';
import styles from './CheckboxField.module.css';

export interface CheckboxFieldProps {
  readonly label: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly hint?: string;
}

/**
 * A labelled checkbox (SDD-090, canvas `AjustesGeneral.dc.html`). The `<label>` wraps the input so the accessible
 * name is the label text and the whole row is the click target (44 px tall on a phone).
 */
export function CheckboxField({ label, checked, onChange, hint }: CheckboxFieldProps): ReactElement {
  const hintId = `${useId()}-hint`;
  return (
    <div className={styles.field}>
      <label className={styles.row}>
        <input
          type="checkbox"
          className={styles.box}
          checked={checked}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={styles.label}>{label}</span>
      </label>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
