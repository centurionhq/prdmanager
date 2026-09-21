/**
 * The navigation of one section of the app (SDD-056/PRD-036 R2, canvas `AjustesGeneral.dc.html`): links
 * gathered in titled groups, the current one marked. It was markup Ajustes built for itself; as a component,
 * the next section that needs a sub-navigation does not build a second one.
 *
 * On a phone the groups' titles are hidden and the links become one horizontal strip that scrolls (canvas
 * `AjustesGeneralMobile.dc.html`): a column of grouped links would push the screen itself below the fold.
 * The titles stay in the DOM, so the groups keep their accessible names.
 */
import { useId, type ReactElement } from 'react';
import { NavLink } from 'react-router';
import styles from './SubNav.module.css';

export interface SubNavItem {
  readonly to: string;
  readonly label: string;
}

export interface SubNavGroup {
  readonly title: string;
  readonly items: readonly SubNavItem[];
}

export interface SubNavProps {
  /** Accessible name of the navigation landmark. */
  readonly label: string;
  readonly groups: readonly SubNavGroup[];
}

function linkClassName({ isActive }: { readonly isActive: boolean }): string {
  return [styles.link, isActive ? styles.active : null].filter((value): value is string => Boolean(value)).join(' ');
}

export function SubNav({ label, groups }: SubNavProps): ReactElement {
  const idPrefix = useId();

  return (
    <nav aria-label={label} className={styles.nav}>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group, index) => {
          const titleId = `${idPrefix}-${index}`;
          return (
            <div key={group.title} role="group" aria-labelledby={titleId} className={styles.group}>
              <span id={titleId} className={styles.title}>
                {group.title}
              </span>
              <ul className={styles.list}>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} className={linkClassName}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </nav>
  );
}
