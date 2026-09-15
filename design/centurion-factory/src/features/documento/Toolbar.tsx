/**
 * Formatting toolbar for the preview editor (WO-300): `role="toolbar"` with roving arrow-key
 * focus, a block-style group (aria-pressed), inline marks, list/task converters and Enlace.
 */
import { Link as LinkIcon, List, ListChecks, ListOrdered } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Button } from '../../components';
import type { BlockType } from '../../data';
import styles from './Toolbar.module.css';

export interface ToolbarProps {
  readonly blockType: BlockType | undefined;
  readonly onSetBlockType: (type: BlockType) => void;
  readonly onFormatSelection: (marker: '**' | '_' | '~~') => void;
  readonly onInsertLink: (url: string) => void;
}

const BLOCK_STYLE_OPTIONS: readonly { readonly type: BlockType; readonly label: string }[] = [
  { type: 'p', label: 'Párrafo' },
  { type: 'h1', label: 'Título 1' },
  { type: 'h2', label: 'Título 2' },
  { type: 'h3', label: 'Título 3' },
];

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

function LinkPopover({ onSubmit, onCancel }: { readonly onSubmit: (url: string) => void; readonly onCancel: () => void }): ReactElement {
  const [url, setUrl] = useState('');
  const inputId = useId();

  return (
    <form
      className={styles.linkPopover}
      onSubmit={(event) => {
        event.preventDefault();
        if (url.trim()) onSubmit(url.trim());
      }}
    >
      <label className="visually-hidden" htmlFor={inputId}>
        URL del enlace
      </label>
      <input id={inputId} className={styles.linkInput} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" autoFocus />
      <Button type="submit" variant="secondary" size="sm">
        Insertar
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}

export function Toolbar({ blockType, onSetBlockType, onFormatSelection, onInsertLink }: ToolbarProps): ReactElement {
  const [linkOpen, setLinkOpen] = useState(false);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!NEXT_KEYS.has(event.key) && !PREVIOUS_KEYS.has(event.key) && event.key !== 'Home' && event.key !== 'End') return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (activeIndex === -1) return;

    let targetIndex = activeIndex;
    if (NEXT_KEYS.has(event.key)) targetIndex = (activeIndex + 1) % buttons.length;
    else if (PREVIOUS_KEYS.has(event.key)) targetIndex = (activeIndex - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = buttons.length - 1;

    event.preventDefault();
    buttons[targetIndex]?.focus();
  }

  return (
    <div role="toolbar" aria-label="Formato" className={styles.toolbar} onKeyDown={handleKeyDown}>
      <div className={styles.group}>
        {BLOCK_STYLE_OPTIONS.map((option) => (
          <button
            key={option.type}
            type="button"
            aria-pressed={blockType === option.type}
            className={[styles.button, styles.textButton, blockType === option.type ? styles.pressed : null].filter(Boolean).join(' ')}
            onClick={() => onSetBlockType(option.type)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className={styles.divider} aria-hidden="true" />
      <button type="button" title="Negrita" aria-label="Negrita" className={styles.button} onClick={() => onFormatSelection('**')}>
        <span className={styles.bold} aria-hidden="true">
          B
        </span>
      </button>
      <button type="button" title="Cursiva" aria-label="Cursiva" className={styles.button} onClick={() => onFormatSelection('_')}>
        <span className={styles.italic} aria-hidden="true">
          I
        </span>
      </button>
      <button type="button" title="Tachado" aria-label="Tachado" className={styles.button} onClick={() => onFormatSelection('~~')}>
        <span className={styles.strike} aria-hidden="true">
          S
        </span>
      </button>
      <span className={styles.divider} aria-hidden="true" />
      <button type="button" title="Lista con viñetas" aria-label="Lista con viñetas" className={styles.button} onClick={() => onSetBlockType('li')}>
        <List aria-hidden="true" size={18} />
      </button>
      <button type="button" title="Lista numerada" aria-label="Lista numerada" className={styles.button} onClick={() => onSetBlockType('ol')}>
        <ListOrdered aria-hidden="true" size={18} />
      </button>
      <button type="button" title="Lista de tareas" aria-label="Lista de tareas" className={styles.button} onClick={() => onSetBlockType('task')}>
        <ListChecks aria-hidden="true" size={18} />
      </button>
      <span className={styles.divider} aria-hidden="true" />
      <button type="button" title="Enlace" aria-label="Enlace" className={styles.button} onClick={() => setLinkOpen(true)}>
        <LinkIcon aria-hidden="true" size={18} />
      </button>
      {linkOpen ? (
        <LinkPopover
          onSubmit={(url) => {
            onInsertLink(url);
            setLinkOpen(false);
          }}
          onCancel={() => setLinkOpen(false)}
        />
      ) : null}
    </div>
  );
}
