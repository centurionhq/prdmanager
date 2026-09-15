/**
 * UI/a11y review (Phase 3 gate, HIGH finding): several screens swap their entire form for a new step or a
 * confirmation message (2FA challenge, "check your email", "invitation accepted"...) with no signal to a
 * screen-reader user that anything changed — they stay wherever focus was, in a form that no longer
 * exists. Moving focus to the new step's heading (a WAI-ARIA Authoring Practices pattern for multi-step
 * forms) makes the change reliably announced without the risk of double-announcing that a live region
 * layered on top of a focus move would add.
 */
import { useEffect, useRef } from 'react';

export function useFocusOnChange<T extends HTMLElement>(dependency: unknown): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [dependency]);
  return ref;
}
