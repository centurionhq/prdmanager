/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/*` layout (SDD-013 §"Shell y router", ADR-008): the project name/
 * org header plus a sub-nav to each ajustes screen (general/miembros/tokens/tokens-personales/perfil/
 * auditoría) and an outlet for the active one.
 */
import type { ReactElement } from 'react';
import { Outlet } from 'react-router';
import { PageHeader, SubNav, type SubNavGroup } from '../components/index.js';
import { projectBasePath } from '../components/shell/project-nav.js';
import { useProjectShellContext } from './ProjectShell.js';
import styles from './AjustesLayout.module.css';

/** Only destinations that exist, grouped as the approved canvas groups them (`AjustesGeneral.dc.html`). The
 * routes are the ones they always had: moving or adding destinations is a different PRD (PRD-036 leaves it out). */
function ajustesGroups(base: string, projectName: string): readonly SubNavGroup[] {
  return [
    {
      title: `Proyecto ${projectName}`,
      items: [
        { to: `${base}/general`, label: 'General' },
        { to: `${base}/miembros`, label: 'Miembros' },
        { to: `${base}/tokens`, label: 'Tokens de CI' },
        { to: `${base}/auditoria`, label: 'Auditoría' },
      ],
    },
    {
      title: 'Tu cuenta',
      items: [
        { to: `${base}/perfil`, label: 'Perfil' },
        { to: `${base}/tokens-personales`, label: 'Tokens personales' },
      ],
    },
  ];
}

export function AjustesLayout(): ReactElement {
  const context = useProjectShellContext();
  const { orgSlug, projectSlug, project, currentOrg } = context;
  const base = `${projectBasePath(orgSlug, projectSlug)}/ajustes`;

  return (
    <div className={styles.page}>
      <PageHeader title="Ajustes" subtitle={`Proyecto ${project.name}, organización ${currentOrg.name}`} />
      <div className={styles.layout}>
        <SubNav label="Ajustes" groups={ajustesGroups(base, project.name)} />
        <section className={styles.section}>
          <Outlet context={context} />
        </section>
      </div>
    </div>
  );
}
