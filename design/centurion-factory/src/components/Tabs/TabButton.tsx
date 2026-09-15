import type { ReactElement } from 'react';
import styles from './Tabs.module.css';
import type { TabDef, TabsClassNames } from './Tabs';

function defaultTabClassName(selected: boolean): string {
  return [styles.tab, selected ? styles.selected : null].filter((value): value is string => Boolean(value)).join(' ');
}

export interface TabButtonProps {
  readonly tab: TabDef;
  readonly selected: boolean;
  readonly idPrefix: string;
  readonly onSelect: (id: string) => void;
  readonly className: TabsClassNames['tab'];
}

/** A single `role="tab"` button, with roving `tabIndex` (only the selected tab is 0). */
export function TabButton({ tab, selected, idPrefix, onSelect, className }: TabButtonProps): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      id={`${idPrefix}-tab-${tab.id}`}
      aria-selected={selected}
      aria-controls={`${idPrefix}-panel-${tab.id}`}
      tabIndex={selected ? 0 : -1}
      className={className ? className(selected) : defaultTabClassName(selected)}
      onClick={() => onSelect(tab.id)}
    >
      {tab.label}
    </button>
  );
}
