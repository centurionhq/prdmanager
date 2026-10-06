import { ChevronsUpDown } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import type { AppShellData } from './AppShell.js';
import { buildPrimaryNav, initialsFor, projectBasePath } from './project-nav.js';
import styles from './Sidebar.module.css';

function DriftBadge({ to, base, count }: { readonly to: string; readonly base: string; readonly count: number }): ReactElement | null {
  if (to !== `${base}/drift` || count <= 0) return null;
  return (
    <span className={styles.andonBadge}>
      <span aria-hidden="true" className="num">
        {count}
      </span>
      <span className="visually-hidden">{count} errores de drift</span>
    </span>
  );
}

export function Sidebar({ data }: { readonly data: AppShellData }): ReactElement {
  const { pathname } = useLocation();
  const base = projectBasePath(data.orgSlug, data.projectSlug);
  const isSettings = pathname.startsWith(`${base}/ajustes`);
  const items = buildPrimaryNav(data.orgSlug, data.projectSlug);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>Centurion Factory</div>
      <Link
        to={`/o/${data.orgSlug}`}
        className={styles.switcher}
        aria-label={`Cambiar de proyecto. Actual: ${data.projectName} en ${data.orgName}`}
      >
        <span className={styles.switcherText}>
          <span className={styles.switcherOrg}>{data.orgName}</span>
          <span className={styles.switcherProject}>{data.projectName}</span>
        </span>
        <ChevronsUpDown aria-hidden="true" size={16} strokeWidth={2} className={styles.switcherIcon} />
      </Link>
      <nav aria-label="Navegación principal">
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}>
                <span className={styles.label}>{item.label}</span>
                <DriftBadge to={item.to} base={base} count={data.driftErrorCount} />
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.footer}>
        <Link
          to={`${base}/ajustes/general`}
          className={isSettings ? `${styles.link} ${styles.active}` : styles.link}
          aria-current={isSettings ? 'page' : undefined}
        >
          Ajustes
        </Link>
        <Link
          to={`${base}/ajustes/perfil`}
          className={styles.person}
          aria-label={`Tu cuenta: ${data.personName} (${data.personRole})`}
        >
          <span className={styles.avatar} aria-hidden="true">
            {initialsFor(data.personName)}
          </span>
          <span className={styles.personText}>
            <span className={styles.personName}>{data.personName}</span>
            <span className={styles.personRole}>{data.personRole}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
