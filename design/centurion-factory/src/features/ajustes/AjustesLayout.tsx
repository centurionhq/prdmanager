import type { ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '../../components';
import styles from './AjustesLayout.module.css';
import { AJUSTES_NAV_GROUPS } from './nav';

function navLinkClassName({ isActive }: { readonly isActive: boolean }): string {
  return [styles.link, isActive ? styles.active : null].filter((value): value is string => Boolean(value)).join(' ');
}

/** /ajustes layout: title, sub-nav grouped by scope, and the section outlet (WO-304). */
export function AjustesLayout(): ReactElement {
  return (
    <div className={styles.page}>
      <PageHeader title="Ajustes" subtitle="Proyecto prdmanager, organización Centurion HQ y tu cuenta" />
      <div className={styles.layout}>
        <nav aria-label="Ajustes" className={styles.nav}>
          {AJUSTES_NAV_GROUPS.map((group) => (
            <div key={group.label} className={styles.group}>
              <div className={styles.groupLabel}>{group.label}</div>
              <ul className={styles.list}>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end className={navLinkClassName}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <section className={styles.section}>
          <Outlet />
        </section>
      </div>
    </div>
  );
}
