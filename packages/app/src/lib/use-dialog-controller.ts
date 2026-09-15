/**
 * Shared open/close/focus lifecycle for Modal and Drawer, both built on the native `<dialog>`
 * element (SDD-011). jsdom has no `showModal`/`close`, so both are guarded and fall back to
 * toggling the `open` property directly.
 */
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';

export interface UseDialogControllerOptions {
  readonly open: boolean;
  readonly onClose: () => void;
}

export interface UseDialogControllerResult {
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
}

function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.open = true;
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (!dialog.open) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.open = false;
}

/** Opens/closes the dialog to match `open`, moves focus in, and returns it to the trigger on close. */
export function useDialogController({ open, onClose }: UseDialogControllerOptions): UseDialogControllerResult {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openDialog(dialog);
      dialog.focus();
    } else {
      closeDialog(dialog);
      previouslyFocused.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    function handleCancel(event: Event): void {
      event.preventDefault();
      onClose();
    }

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return { dialogRef };
}

export interface ScrimCloseHandlers {
  readonly onMouseDown: (event: ReactMouseEvent<HTMLDialogElement>) => void;
  readonly onClick: (event: ReactMouseEvent<HTMLDialogElement>) => void;
}

/**
 * Closes the dialog only when BOTH the mousedown and the click land on the scrim itself
 * (the `<dialog>` element, not the panel inside it). Without this, a drag that starts on
 * panel content — like selecting text in an input — and is released over the scrim would
 * otherwise fire a click on the dialog and close it.
 */
export function useScrimClose(onClose: () => void): ScrimCloseHandlers {
  const mouseDownOnScrim = useRef(false);

  function onMouseDown(event: ReactMouseEvent<HTMLDialogElement>): void {
    mouseDownOnScrim.current = event.target === event.currentTarget;
  }

  function onClick(event: ReactMouseEvent<HTMLDialogElement>): void {
    const clickedScrim = event.target === event.currentTarget;
    if (clickedScrim && mouseDownOnScrim.current) onClose();
    mouseDownOnScrim.current = false;
  }

  return { onMouseDown, onClick };
}
