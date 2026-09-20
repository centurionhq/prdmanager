import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import styles from './OptionPlates.module.css';

export interface OptionPlate {
  readonly value: string;
  /** What this option is, in the person's own words. */
  readonly title: string;
  /** One sentence on what choosing it lets them do. */
  readonly description: string;
  /** Optional line under the description for what identifies the option rather than explains it (an id, a
   * count). It is part of the plate, so it is read as part of the option's name. */
  readonly meta?: ReactNode;
}

export interface OptionPlatesProps {
  /** Accessible name of the whole group. */
  readonly label: string;
  readonly options: readonly OptionPlate[];
  readonly onChange: (value: string) => void;
  /**
   * `radio` (default): one option is selected and stays selected -- a real radiogroup, so the arrow keys
   * move the selection like any other radio. Use it when picking is a choice a later step confirms.
   *
   * `action`: picking is the whole action and it commits at once (the Planta's entry band saves the
   * profile the moment it is chosen). Rendered as a plain group of buttons, because with radio semantics
   * the arrow keys would "select" -- and therefore save -- an option the person only meant to look at.
   */
  readonly mode?: 'radio' | 'action';
  /** Selected value in `radio` mode; `null` when nothing is chosen yet. Ignored in `action` mode. */
  readonly value?: string | null;
  /** `row` (default) lays the plates side by side and lets them wrap; `stack` keeps them in one column. */
  readonly layout?: 'row' | 'stack';
  /** Draw a filled/hollow square, so selection never depends on colour alone. `radio` mode only. */
  readonly marker?: boolean;
}

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

function join(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

/**
 * Selectable option plates: a title and a sentence each, larger than a chip and meant to be read.
 * `FilterChips` is the closest existing piece, but it is a row of short filters; this one carries an
 * explanation per option (PRD-011 §6: when a component is missing it is created, not inlined).
 */
export function OptionPlates({ label, options, onChange, mode = 'radio', value = null, layout = 'row', marker = false }: OptionPlatesProps): ReactElement {
  const groupClass = join(styles.group, layout === 'stack' && styles.stack);

  if (mode === 'action') {
    return (
      <div role="group" aria-label={label} className={groupClass}>
        {options.map((option) => (
          <button key={option.value} type="button" className={styles.plate} onClick={() => onChange(option.value)}>
            <span className={styles.body}>
              <span className={styles.title}>{option.title}</span>
              <span className={styles.description}>{option.description}</span>
              {option.meta ? <span className={styles.meta}>{option.meta}</span> : null}
            </span>
          </button>
        ))}
      </div>
    );
  }

  // Exactly one plate is in the tab order: the selected one, or the first while nothing is chosen.
  const tabbableValue = options.some((option) => option.value === value) ? value : options[0]?.value;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (options.length === 0 || (!NEXT_KEYS.has(event.key) && !PREVIOUS_KEYS.has(event.key))) return;

    const plates = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const activeIndex = plates.indexOf(document.activeElement as HTMLButtonElement);
    if (activeIndex === -1) return;

    event.preventDefault();
    const step = NEXT_KEYS.has(event.key) ? 1 : -1;
    const targetIndex = (activeIndex + step + options.length) % options.length;
    const targetOption = options[targetIndex];
    const targetPlate = plates[targetIndex];
    if (!targetOption || !targetPlate) return;

    targetPlate.focus();
    onChange(targetOption.value);
  }

  return (
    <div role="radiogroup" aria-label={label} className={groupClass} onKeyDown={handleKeyDown}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={option.value === tabbableValue ? 0 : -1}
            className={join(styles.plate, selected && styles.selected)}
            onClick={() => onChange(option.value)}
          >
            {marker ? <span className={join(styles.marker, selected && styles.markerOn)} aria-hidden="true" /> : null}
            <span className={styles.body}>
              <span className={styles.title}>{option.title}</span>
              <span className={styles.description}>{option.description}</span>
              {option.meta ? <span className={styles.meta}>{option.meta}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
