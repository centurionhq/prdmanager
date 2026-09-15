import type { KeyboardEvent, ReactElement } from 'react';
import styles from './FilterChips.module.css';

export interface FilterChipOption {
  readonly value: string;
  readonly label: string;
  readonly count?: number;
}

export interface FilterChipsProps {
  readonly label: string;
  readonly options: readonly FilterChipOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

/** A radiogroup of filter chips: grafito/acero when selected, surface with a rule border otherwise. */
export function FilterChips({ label, options, value, onChange }: FilterChipsProps): ReactElement {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (options.length === 0 || (!NEXT_KEYS.has(event.key) && !PREVIOUS_KEYS.has(event.key))) return;

    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (activeIndex === -1) return;

    event.preventDefault();
    const step = NEXT_KEYS.has(event.key) ? 1 : -1;
    const targetIndex = (activeIndex + step + options.length) % options.length;
    const targetOption = options[targetIndex];
    const targetButton = buttons[targetIndex];
    if (!targetOption || !targetButton) return;

    targetButton.focus();
    onChange(targetOption.value);
  }

  return (
    <div role="radiogroup" aria-label={label} className={styles.group} onKeyDown={handleKeyDown}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={[styles.chip, selected ? styles.selected : null].filter((entry): entry is string => Boolean(entry)).join(' ')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count !== undefined ? <span className={styles.count}>{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
