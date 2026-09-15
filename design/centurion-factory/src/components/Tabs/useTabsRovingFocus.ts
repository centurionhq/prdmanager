import type { KeyboardEvent } from 'react';
import type { TabDef } from './Tabs';

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

function targetIndexFor(key: string, activeIndex: number, count: number): number | undefined {
  if (NEXT_KEYS.has(key)) return (activeIndex + 1) % count;
  if (PREVIOUS_KEYS.has(key)) return (activeIndex - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

export interface UseTabsRovingFocusOptions {
  readonly tabs: readonly TabDef[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  readonly idPrefix: string;
}

/**
 * Arrow-key/Home/End roving focus for a `role="tablist"`: moves both focus and selection to the
 * target tab button, per the WAI-ARIA tabs pattern.
 */
export function useTabsRovingFocus({ tabs, activeId, onChange, idPrefix }: UseTabsRovingFocusOptions) {
  return function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const activeIndex = buttons.findIndex((button) => button.id === `${idPrefix}-tab-${activeId}`);
    if (activeIndex === -1) return;

    const targetIndex = targetIndexFor(event.key, activeIndex, tabs.length);
    if (targetIndex === undefined) return;

    event.preventDefault();
    const targetTab = tabs[targetIndex];
    const targetButton = buttons[targetIndex];
    if (!targetTab || !targetButton) return;
    targetButton.focus();
    onChange(targetTab.id);
  };
}
