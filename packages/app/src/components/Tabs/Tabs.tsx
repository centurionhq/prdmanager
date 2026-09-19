/**
 * Generic accessible tabs primitive (WO-287, moved to src/components in WO-319):
 * `role="tablist"`/`"tab"`/`"tabpanel"` with roving arrow-key focus (Home/End included).
 *
 * Every caller gets the same ARIA wiring and keyboard support; `classNames` lets a screen keep
 * its own visual design (padding, borders, colors) instead of the default look in Tabs.module.css.
 */
import type { ReactElement, ReactNode } from 'react';
import styles from './Tabs.module.css';
import { TabButton } from './TabButton';
import { useTabsRovingFocus } from './useTabsRovingFocus';

export interface TabDef {
  readonly id: string;
  readonly label: ReactNode;
  readonly panel: ReactNode;
  /**
   * WO-501 (SDD-041/PRD-020): keep this tab's panel mounted while another tab is shown, instead of the
   * default unmount-on-switch.
   *
   * Opt-in, so no existing tab changes behaviour. The agent panel needs it because unmounting runs its
   * effect cleanup, which aborts the in-flight turn: a user who clicked "Comentarios" mid-answer killed
   * the turn and was told nothing. The panel stays in the DOM but inside a `hidden` container, so it is
   * out of the accessibility tree and out of tab order exactly as before.
   */
  readonly keepMounted?: boolean;
}

export interface TabsClassNames {
  readonly wrapper?: string;
  readonly tablist?: string;
  /** Given whether the tab is selected, returns its className. */
  readonly tab?: (selected: boolean) => string;
  readonly panel?: string;
}

export interface TabsProps {
  readonly ariaLabel: string;
  readonly tabs: readonly TabDef[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  readonly idPrefix: string;
  readonly classNames?: TabsClassNames;
}

export function Tabs({ ariaLabel, tabs, activeId, onChange, idPrefix, classNames }: TabsProps): ReactElement {
  const handleKeyDown = useTabsRovingFocus({ tabs, activeId, onChange, idPrefix });

  return (
    <div className={classNames?.wrapper ?? styles.wrapper}>
      <div role="tablist" aria-label={ariaLabel} className={classNames?.tablist ?? styles.tablist} onKeyDown={handleKeyDown}>
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            selected={tab.id === activeId}
            idPrefix={idPrefix}
            onSelect={onChange}
            className={classNames?.tab}
          />
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${idPrefix}-panel-${tab.id}`}
          aria-labelledby={`${idPrefix}-tab-${tab.id}`}
          hidden={tab.id !== activeId}
          className={classNames?.panel ?? styles.panel}
        >
          {tab.id === activeId || tab.keepMounted === true ? tab.panel : null}
        </div>
      ))}
    </div>
  );
}
