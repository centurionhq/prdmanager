import { ClipboardList, Factory, FileText, Network, TriangleAlert, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import styles from './BottomBar.module.css';
import { PRIMARY_NAV } from './nav';

const ICONS: Readonly<Record<string, LucideIcon>> = {
  '/': Factory,
  '/arbol': Network,
  '/documentos': FileText,
  '/ordenes': ClipboardList,
  '/drift': TriangleAlert,
};

const MOBILE_ITEMS = PRIMARY_NAV.filter((item) => item.to in ICONS);

export function BottomBar() {
  return (
    <nav aria-label="Navegación móvil" className={styles.bar}>
      <ul className={styles.list}>
        {MOBILE_ITEMS.map((item) => {
          const Icon = ICONS[item.to] ?? Factory;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? `${styles.item} ${styles.active}` : styles.item)}
              >
                <Icon aria-hidden="true" size={20} strokeWidth={2} />
                <span>{item.shortLabel}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
