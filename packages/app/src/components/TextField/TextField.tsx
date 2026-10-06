import { useId, type ReactElement } from 'react';
import styles from './TextField.module.css';

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange?: (value: string) => void;
  readonly hint?: string;
  /** A message to show as an alert under the field; also marks it invalid for assistive technology. */
  readonly error?: string | null;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly type?: 'text' | 'email' | 'date';
  /** Client-side upper bound for a `date` field; the server stays the one that decides. */
  readonly max?: string;
  /** Renders a `<textarea>` instead of an `<input>`. */
  readonly multiline?: boolean;
  readonly rows?: number;
  /** The value is a literal (a path, a glob, a sha): the mono face. */
  readonly mono?: boolean;
  readonly inputMode?: 'text' | 'numeric' | 'decimal';
}

/**
 * A labelled text input (SDD-056/PRD-036 R2, canvas `AjustesGeneral.dc.html`): label above, the control, then
 * its hint and, when there is one, its error. Every form of the Ajustes section builds fields from this rather
 * than from a `.field` class it has to remember to wire up -- the label is always tied to the input, the hint
 * and the error are always described by it, and an invalid field is never only red.
 */
export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
  disabled,
  required,
  type = 'text',
  max,
  multiline = false,
  rows,
  mono = false,
  inputMode,
}: TextFieldProps): ReactElement {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const controlProps = {
    id,
    value,
    placeholder,
    disabled,
    required,
    inputMode,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy,
  };

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...controlProps}
          className={[styles.input, styles.textarea, mono ? styles.mono : ''].filter(Boolean).join(' ')}
          rows={rows}
          onChange={(event) => onChange?.(event.target.value)}
        />
      ) : (
        <input
          {...controlProps}
          type={type}
          className={mono ? `${styles.input} ${styles.mono}` : styles.input}
          max={max}
          onChange={(event) => onChange?.(event.target.value)}
        />
      )}
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
