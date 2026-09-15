import { Search, X } from 'lucide-react';
import { useId, type ChangeEvent, type ReactElement } from 'react';
import styles from './SearchField.module.css';

export interface SearchFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  /** The canvas shows no visible label text; set to `false` to render one. Defaults to `true`. */
  readonly hideLabel?: boolean;
}

/** Search input with a lucide icon and a clear button that appears once there is text. */
export function SearchField({ label, value, onChange, placeholder, hideLabel = true }: SearchFieldProps): ReactElement {
  const inputId = useId();

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.target.value);
  }

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={hideLabel ? 'visually-hidden' : styles.label}>
        {label}
      </label>
      <div className={styles.control}>
        <Search aria-hidden="true" size={16} className={styles.icon} />
        <input
          id={inputId}
          type="search"
          className={styles.input}
          value={value}
          placeholder={placeholder}
          onChange={handleChange}
        />
        {value ? (
          <button type="button" aria-label="Borrar búsqueda" className={styles.clear} onClick={() => onChange('')}>
            <X aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
