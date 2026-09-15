import { ClipboardList, Ellipsis, Factory, FileText, Network, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
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

const MORE_ITEMS = [
  { to: '/entrada', label: 'Bandeja de entrada' },
  { to: '/ajustes/miembros', label: 'Ajustes' },
  { to: '/proyectos', label: 'Cambiar de proyecto' },
] as const;

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? `${styles.item} ${styles.active}` : (styles.item ?? '');
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.item}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis aria-hidden="true" size={20} strokeWidth={2} />
        <span>Más</span>
      </button>
      {open && (
        <ul id={menuId} aria-label="Más destinos" className={styles.moreMenu}>
          {MORE_ITEMS.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={styles.moreLink}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function BottomBar() {
  return (
    <nav aria-label="Navegación móvil" className={styles.bar}>
      <ul className={styles.list}>
        {MOBILE_ITEMS.map((item) => {
          const Icon = ICONS[item.to] ?? Factory;
          return (
            <li key={item.to} className={styles.cell}>
              <NavLink to={item.to} end={item.end} className={linkClass}>
                <Icon aria-hidden="true" size={20} strokeWidth={2} />
                <span>{item.shortLabel}</span>
              </NavLink>
            </li>
          );
        })}
        <li className={styles.cell}>
          <MoreMenu />
        </li>
      </ul>
    </nav>
  );
}
