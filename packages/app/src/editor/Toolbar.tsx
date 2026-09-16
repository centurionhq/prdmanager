/**
 * Formatting toolbar for the preview editor (SDD-014 §"Editor de vista previa", WO-379), ported from the
 * Centurion Factory canvas's `design/centurion-factory/src/features/documento/Toolbar.tsx` — same visual
 * layout and `role="toolbar"` roving-focus keyboard behavior, but every button now calls `edit-ops.ts`'s
 * real pure functions against `source`/`activeBlock`/`selectionRange` instead of mutating a mock block
 * model directly. `PreviewEditor.tsx` owns applying the resulting `Splice` to the live `Y.Text`.
 *
 * List/ordered-list conversion buttons from the design canvas are intentionally left out: `edit-ops.ts`
 * (WO-377) only ever supports `paragraph`/`heading1-3` for `setBlockType`, plus `toggleTask` for an
 * *existing* task-item's checkbox — there is no operation yet that turns an arbitrary block into a list,
 * so wiring a button to nothing would just be dead UI.
 */
import { Link as LinkIcon } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import { Button } from '../components/Button/Button.js';
import { insertLink, isProtectedTareasHeading, setBlockType, toggleMark, toggleTask, type Splice } from './edit-ops.js';
import type { SourceBlock } from './source-map.js';
import styles from './Toolbar.module.css';

export type ToggleableMark = 'strong' | 'emphasis' | 'strikethrough';

const MARK_LABEL: Readonly<Record<ToggleableMark, string>> = { strong: 'Negrita', emphasis: 'Cursiva', strikethrough: 'Tachado' };
const MARK_DELIMITER: Readonly<Record<ToggleableMark, string>> = { strong: '**', emphasis: '*', strikethrough: '~~' };

type BlockStyleKind = 'paragraph' | 'heading1' | 'heading2' | 'heading3';

const BLOCK_STYLE_OPTIONS: readonly { readonly kind: BlockStyleKind; readonly label: string }[] = [
  { kind: 'paragraph', label: 'Párrafo' },
  { kind: 'heading1', label: 'Título 1' },
  { kind: 'heading2', label: 'Título 2' },
  { kind: 'heading3', label: 'Título 3' },
];

/** Maps a keyboard event to the mark it toggles (`Ctrl`/`Cmd`+`B`/`I`), or `null` for anything else.
 * `PreviewEditor.tsx` wires this to its container's `keydown` — the toolbar buttons themselves are never
 * focused while the user is typing, so the shortcut has to be recognized where the keystroke actually
 * lands. */
export function matchMarkShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean }): ToggleableMark | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.key.toLowerCase() === 'b') return 'strong';
  if (event.key.toLowerCase() === 'i') return 'emphasis';
  return null;
}

function isMarkActive(block: SourceBlock, from: number, to: number, mark: ToggleableMark): boolean {
  if (from === to) return false;
  const selFrom = block.contentFrom + from;
  const selTo = block.contentFrom + to;
  return (block.runs ?? []).some((run) => run.kind === mark && run.from <= selFrom && run.to >= selTo);
}

export interface ToolbarSelectionRange {
  from: number;
  to: number;
}

export interface ToolbarProps {
  readonly source: string;
  readonly activeBlock: SourceBlock | null;
  readonly selectionRange: ToolbarSelectionRange | null;
  readonly onApplySplice: (splice: Splice) => void;
}

/** Prevents the browser's default mousedown focus-shift, so the block keeps the selection the toolbar is
 * about to act on. */
function keepFocus(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

interface LinkPopoverProps {
  readonly onSubmit: (url: string) => void;
  readonly onCancel: () => void;
}

function LinkPopover({ onSubmit, onCancel }: LinkPopoverProps): ReactElement {
  const [url, setUrl] = useState('');
  const inputId = useId();

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onCancel();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (url.trim()) onSubmit(url.trim());
  }

  return (
    <form className={styles.linkPopover} onKeyDown={handleKeyDown} onSubmit={handleSubmit}>
      <label className={styles.srOnly} htmlFor={inputId}>
        URL del enlace
      </label>
      <input id={inputId} className={styles.linkInput} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" autoFocus />
      <Button type="submit" variant="secondary" size="sm">
        Insertar
      </Button>
      <Button type="button" variant="ghost" size="sm" onMouseDown={keepFocus} onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

function handleRovingFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (!NEXT_KEYS.has(event.key) && !PREVIOUS_KEYS.has(event.key) && event.key !== 'Home' && event.key !== 'End') return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
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

interface CapturedLinkSelection {
  readonly block: SourceBlock;
  readonly from: number;
  readonly to: number;
}

export function Toolbar({ source, activeBlock, selectionRange, onApplySplice }: ToolbarProps): ReactElement {
  const [linkOpen, setLinkOpen] = useState(false);
  // WO-387 (accessibility gate): a real browser collapses `window.getSelection()` the instant focus moves
  // into the popover's own `autoFocus`ed input — `usePreviewSelection`'s live `selectionchange` listener
  // then reports `null` for as long as the popover stays open, which a jsdom-based unit test (no real
  // selection-follows-focus behavior) never surfaces. Capturing the selection at the moment the popover
  // *opens* — same reasoning as `PreviewEditor.tsx`'s own `CommentTrigger`/`onCapture` — is what keeps
  // "Insertar" working at all, not just what makes the toolbar's own re-disable-on-close predictable.
  const [capturedLink, setCapturedLink] = useState<CapturedLinkSelection | null>(null);
  const linkButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // Closing the popover (via Cancel, Escape, or a successful "Insertar") unmounts its `autoFocus`ed input
  // — with nothing else done, focus would silently fall back to `document.body`, an easy-to-miss dead end
  // for a keyboard/AT user. Same "return focus to the trigger" convention `use-dialog-controller.ts`
  // already uses for real `<dialog>`s (never a focus *trap* here, though — this is a non-modal inline
  // popover, and trapping focus out of it would itself be the anti-pattern). The trigger is disabled again
  // by the time this runs whenever the underlying selection is now genuinely gone (the normal case right
  // after inserting a link collapses it) — a disabled control can never receive focus, so the toolbar's
  // own root (`tabIndex={-1}`, focusable only programmatically) is the fallback rather than leaving focus
  // to land nowhere.
  function closeLinkPopover(): void {
    setLinkOpen(false);
    setCapturedLink(null);
    const trigger = linkButtonRef.current;
    if (trigger && !trigger.disabled) trigger.focus();
    else toolbarRef.current?.focus();
  }

  const hasSelection = selectionRange !== null && selectionRange.from !== selectionRange.to;
  const blockTypeDisabled = !activeBlock || activeBlock.kind === 'island' || isProtectedTareasHeading(activeBlock, source);
  const markDisabled = !activeBlock || !hasSelection;
  const linkDisabled = !activeBlock || !hasSelection;
  const taskDisabled = !activeBlock || activeBlock.kind !== 'task-item';

  function openLinkPopover(): void {
    if (!activeBlock || !selectionRange || linkDisabled) return;
    setCapturedLink({ block: activeBlock, from: selectionRange.from, to: selectionRange.to });
    setLinkOpen(true);
  }

  function handleSetBlockType(kind: BlockStyleKind): void {
    if (!activeBlock || blockTypeDisabled) return;
    onApplySplice(setBlockType(activeBlock, kind, source));
  }

  function handleToggleMark(mark: ToggleableMark): void {
    if (!activeBlock || !selectionRange || markDisabled) return;
    const splice = toggleMark(activeBlock, selectionRange.from, selectionRange.to, mark, source);
    if (splice) onApplySplice(splice);
  }

  function handleToggleTask(): void {
    if (!activeBlock || taskDisabled) return;
    onApplySplice(toggleTask(activeBlock));
  }

  function handleInsertLink(href: string): void {
    const captured = capturedLink;
    closeLinkPopover();
    if (!captured) return;
    onApplySplice(insertLink(captured.block, captured.from, captured.to, href, source));
  }

  return (
    <div ref={toolbarRef} role="toolbar" aria-label="Formato" tabIndex={-1} className={styles.toolbar} onKeyDown={handleRovingFocus}>
      <div className={styles.group}>
        {BLOCK_STYLE_OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            aria-pressed={activeBlock?.kind === option.kind}
            disabled={blockTypeDisabled}
            className={[styles.button, styles.textButton, activeBlock?.kind === option.kind ? styles.pressed : null].filter(Boolean).join(' ')}
            onMouseDown={keepFocus}
            onClick={() => handleSetBlockType(option.kind)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className={styles.divider} aria-hidden="true" />
      {(['strong', 'emphasis', 'strikethrough'] as const).map((mark) => (
        <button
          key={mark}
          type="button"
          title={MARK_LABEL[mark]}
          aria-label={MARK_LABEL[mark]}
          aria-pressed={activeBlock ? isMarkActive(activeBlock, selectionRange?.from ?? 0, selectionRange?.to ?? 0, mark) : false}
          disabled={markDisabled}
          className={[styles.button, activeBlock && isMarkActive(activeBlock, selectionRange?.from ?? 0, selectionRange?.to ?? 0, mark) ? styles.pressed : null]
            .filter(Boolean)
            .join(' ')}
          onMouseDown={keepFocus}
          onClick={() => handleToggleMark(mark)}
        >
          <span aria-hidden="true">{MARK_DELIMITER[mark][0]}</span>
        </button>
      ))}
      <span className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        title="Tarea"
        aria-label="Tarea"
        aria-pressed={activeBlock?.kind === 'task-item' && (activeBlock.taskChecked ?? false)}
        disabled={taskDisabled}
        className={styles.button}
        onMouseDown={keepFocus}
        onClick={handleToggleTask}
      >
        <span aria-hidden="true">☑</span>
      </button>
      <span className={styles.divider} aria-hidden="true" />
      <button
        ref={linkButtonRef}
        type="button"
        title="Enlace"
        aria-label="Enlace"
        className={styles.button}
        disabled={linkDisabled}
        onMouseDown={keepFocus}
        onClick={openLinkPopover}
      >
        <LinkIcon aria-hidden="true" size={18} />
      </button>
      {linkOpen ? <LinkPopover onSubmit={handleInsertLink} onCancel={closeLinkPopover} /> : null}
    </div>
  );
}
