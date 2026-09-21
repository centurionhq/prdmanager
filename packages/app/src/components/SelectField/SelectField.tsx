import { useId, type ReactElement } from 'react';
import styles from './SelectField.module.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  readonly disabled?: boolean;
  /** Hides the visible label and keeps it for assistive technology: for a select inside a table row, whose
   * column header already says what it is. */
  readonly hideLabel?: boolean;
}

/** A labelled native select (SDD-056/PRD-036 R2): same label/hint wiring and the same box as `TextField`. */
export function SelectField({ label, value, options, onChange, hint, disabled, hideLabel = false }: SelectFieldProps): ReactElement {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={hideLabel ? styles.visuallyHidden : styles.label}>
        {label}
      </label>
      <select id={id} className={styles.select} value={value} disabled={disabled} aria-describedby={hint ? hintId : undefined} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
