/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/*` layout (SDD-013 §"Shell y router", ADR-008): the project name/
 * org header plus a sub-nav to each ajustes screen (general/miembros/tokens/tokens-personales/perfil/
 * auditoría) and an outlet for the active one.
 */
import type { ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '../components/index.js';
import { projectBasePath } from '../components/shell/project-nav.js';
import { useProjectShellContext } from './ProjectShell.js';
import styles from './AjustesLayout.module.css';

const AJUSTES_ITEMS: readonly { to: string; label: string }[] = [
  { to: 'general', label: 'General' },
  { to: 'miembros', label: 'Miembros' },
  { to: 'tokens', label: 'Tokens de CI' },
  { to: 'tokens-personales', label: 'Tokens personales' },
  { to: 'perfil', label: 'Perfil' },
  { to: 'auditoria', label: 'Auditoría' },
];

function navLinkClassName({ isActive }: { readonly isActive: boolean }): string {
  return [styles.link, isActive ? styles.active : null].filter((value): value is string => Boolean(value)).join(' ');
}

export function AjustesLayout(): ReactElement {
  const context = useProjectShellContext();
  const { orgSlug, projectSlug, project, currentOrg } = context;
  const base = `${projectBasePath(orgSlug, projectSlug)}/ajustes`;

  return (
    <div className={styles.page}>
      <PageHeader title="Ajustes" subtitle={`Proyecto ${project.name}, organización ${currentOrg.name}`} />
      <div className={styles.layout}>
        <nav aria-label="Ajustes" className={styles.nav}>
          <ul className={styles.list}>
            {AJUSTES_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={`${base}/${item.to}`} className={navLinkClassName}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <section className={styles.section}>
          <Outlet context={context} />
        </section>
      </div>
    </div>
  );
}
