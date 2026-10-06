/**
 * WO-635 (SDD-069): the copy-to-clipboard behaviour `CopyBlock` grew for itself (WO-567, SDD-055/PRD-033 R4),
 * lifted out so every copyable literal in the app shares one honest implementation.
 *
 * `navigator.clipboard` is absent in an insecure context and can be denied outright, so a failure is a state
 * of its own — never a silent no-op that leaves someone believing they copied something they did not, which
 * is the one thing worse than no button at all.
 */
import { useEffect, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

/** What a failed copy says, verbatim: it names the fallback instead of blaming the person. */
export const COPY_FAILED_MESSAGE = 'No pudimos usar el portapapeles. Seleccionalo y copialo a mano.';

/** The visible label of a copy button for each state. */
export function copyButtonLabel(state: CopyState): string {
  return state === 'copied' ? 'Copiado' : 'Copiar';
}

export interface CopyToClipboardControls {
  readonly state: CopyState;
  readonly copy: () => Promise<void>;
}

export function useCopyToClipboard(text: string): CopyToClipboardControls {
  const [state, setState] = useState<CopyState>('idle');

  // Showing "Copiado" under a different text than the one that was copied would be a lie the moment the same
  // control is reused for another text.
  useEffect(() => setState('idle'), [text]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return { state, copy };
}
