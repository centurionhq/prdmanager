import { ClipboardList, Ellipsis, Factory, FileText, Network, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import type { AppShellData } from './AppShell.js';
import { buildPrimaryNav, projectBasePath } from './project-nav.js';
import styles from './BottomBar.module.css';

/** Keyed by the path suffix after the project base — `''` is the index (Planta) route. Deliberately
 * excludes "Bandeja de entrada": the mock keeps the mobile bar to 5 slots plus "Más", same reasoning as
 * `design/centurion-factory/src/components/shell/BottomBar.tsx`'s own `ICONS` map. */
const ICON_BY_SUFFIX = new Map<string, LucideIcon>([
  ['', Factory],
  ['/arbol', Network],
  ['/documents', FileText],
  ['/ordenes', ClipboardList],
  ['/drift', TriangleAlert],
]);

function suffixFor(to: string, base: string): string {
  return to === base ? '' : to.slice(base.length);
}

function linkClass({ isActive }: { readonly isActive: boolean }): string {
  return isActive ? `${styles.item} ${styles.active}` : (styles.item ?? '');
}

function MoreMenu({ base, orgSlug }: { readonly base: string; readonly orgSlug: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const moreItems = [
    { to: `${base}/entrada`, label: 'Bandeja de entrada' },
    { to: `${base}/ajustes/general`, label: 'Ajustes' },
    { to: `${base}/ajustes/perfil`, label: 'Perfil' },
    { to: `/o/${orgSlug}`, label: 'Cambiar de proyecto' },
  ];

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
          {moreItems.map((item) => (
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

export function BottomBar({ data }: { readonly data: AppShellData }): ReactElement {
  const base = projectBasePath(data.orgSlug, data.projectSlug);
  const mobileItems = buildPrimaryNav(data.orgSlug, data.projectSlug).filter((item) => ICON_BY_SUFFIX.has(suffixFor(item.to, base)));

  return (
    <nav aria-label="Navegación móvil" className={styles.bar}>
      <ul className={styles.list}>
        {mobileItems.map((item) => {
          const Icon = ICON_BY_SUFFIX.get(suffixFor(item.to, base)) ?? Factory;
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
          <MoreMenu base={base} orgSlug={data.orgSlug} />
        </li>
      </ul>
    </nav>
  );
}
