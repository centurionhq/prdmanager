/**
 * Generic accessible tabs primitive (WO-287): `role="tablist"`/`"tab"`/`"tabpanel"` with roving
 * arrow-key focus (Home/End included), shared by the desktop side panel and the mobile tab bar.
 */
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabDef {
  readonly id: string;
  readonly label: ReactNode;
  readonly panel: ReactNode;
}

export interface TabsProps {
  readonly ariaLabel: string;
  readonly tabs: readonly TabDef[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  readonly idPrefix: string;
}

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

function targetIndexFor(key: string, activeIndex: number, count: number): number | undefined {
  if (NEXT_KEYS.has(key)) return (activeIndex + 1) % count;
  if (PREVIOUS_KEYS.has(key)) return (activeIndex - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

export function Tabs({ ariaLabel, tabs, activeId, onChange, idPrefix }: TabsProps): ReactElement {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
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
  }

  return (
    <div className={styles.wrapper}>
      <div role="tablist" aria-label={ariaLabel} className={styles.tablist} onKeyDown={handleKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={[styles.tab, selected ? styles.selected : null].filter((value): value is string => Boolean(value)).join(' ')}
              onClick={() => onChange(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${idPrefix}-panel-${tab.id}`}
          aria-labelledby={`${idPrefix}-tab-${tab.id}`}
          hidden={tab.id !== activeId}
          className={styles.panel}
        >
          {tab.id === activeId ? tab.panel : null}
        </div>
      ))}
    </div>
  );
}
