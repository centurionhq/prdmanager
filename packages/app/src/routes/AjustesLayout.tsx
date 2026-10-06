/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/*` layout (SDD-013 §"Shell y router", ADR-008): the project name/
 * org header plus a sub-nav to each ajustes screen (general/miembros/tokens/auditoría and the two account
 * screens) and an outlet for the active one.
 *
 * SDD-089 §D4 (WO-697): the "Tu cuenta" group no longer points at project-scoped paths — the account
 * screens live at the organization level (`/o/:orgSlug/ajustes/{perfil,tokens-personales}`) and stay
 * reachable from a project screen through those links instead of a second copy of the routes.
 */
import type { ReactElement } from 'react';
import { Outlet } from 'react-router';
import { PageHeader, SubNav, type SubNavGroup } from '../components/index.js';
import { projectBasePath } from '../components/shell/project-nav.js';
import { useProjectShellContext } from './ProjectShell.js';
import styles from './AjustesLayout.module.css';

/** Only destinations that exist, grouped as the approved canvas groups them (`AjustesGeneral.dc.html`). The
 * project group keeps the routes it always had; the account group points at the organization-level screens
 * (SDD-089), which is where those two screens moved. */
function ajustesGroups(base: string, projectName: string, orgSlug: string): readonly SubNavGroup[] {
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
        { to: `/o/${orgSlug}/ajustes/perfil`, label: 'Perfil' },
        { to: `/o/${orgSlug}/ajustes/tokens-personales`, label: 'Tokens personales' },
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
        <SubNav label="Ajustes" groups={ajustesGroups(base, project.name, orgSlug)} />
        <section className={styles.section}>
          <Outlet context={context} />
        </section>
      </div>
    </div>
  );
}
