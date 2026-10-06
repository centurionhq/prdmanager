/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/*` layout (SDD-013 §"Shell y router", ADR-008): the project name/
 * org header plus a sub-nav to each ajustes screen (general/miembros/tokens/auditoría and the two account
 * screens) and an outlet for the active one.
 *
 * SDD-089 §D4 (WO-697): the "Tu cuenta" group no longer points at project-scoped paths — the account
 * screens live at the organization level (`/o/:orgSlug/ajustes/{perfil,tokens-personales}`) and stay
 * reachable from a project screen through those links instead of a second copy of the routes.
 *
 * SDD-089 §D6 (WO-698): the sub-nav stops offering destinations the person looking at it cannot use. Each
 * project destination is decided by the very permission its own screen gates on, so "Miembros" ⇄
 * `manage_members` (`AjustesMiembros`), "Tokens de CI" ⇄ `manage_ci_tokens` (`AjustesTokens`) and
 * "Auditoría" ⇄ `manage_project_settings`; "General" is always there and the account group is never
 * filtered (it belongs to the account, not to the project). The filter lives here rather than in `SubNav`
 * on purpose: that component stays generic (no `@prdm/contracts` in it) and already drops empty groups,
 * so a project with nothing to offer simply does not paint an empty heading. Defense in depth is
 * untouched — every destination keeps its own gate (the `Notice` in `AjustesTokens`, the server's checks);
 * this only changes what the navigation offers.
 */
import type { ReactElement } from 'react';
import { Outlet } from 'react-router';
import { can, type PermissionSubject } from '@prdm/contracts';
import { PageHeader, SubNav, type SubNavGroup, type SubNavItem } from '../components/index.js';
import { projectBasePath } from '../components/shell/project-nav.js';
import { useProjectShellContext } from './ProjectShell.js';
import styles from './AjustesLayout.module.css';

/** Only destinations that exist, grouped as the approved canvas groups them (`AjustesGeneral.dc.html`). The
 * project group keeps the routes it always had; the account group points at the organization-level screens
 * (SDD-089), which is where those two screens moved. */
function ajustesGroups(base: string, projectName: string, orgSlug: string, subject: PermissionSubject): readonly SubNavGroup[] {
  const projectItems: readonly SubNavItem[] = [
    { to: `${base}/general`, label: 'General' },
    ...(can(subject, 'manage_members') ? [{ to: `${base}/miembros`, label: 'Miembros' }] : []),
    ...(can(subject, 'manage_ci_tokens') ? [{ to: `${base}/tokens`, label: 'Tokens de CI' }] : []),
    ...(can(subject, 'manage_project_settings') ? [{ to: `${base}/auditoria`, label: 'Auditoría' }] : []),
  ];

  return [
    { title: `Proyecto ${projectName}`, items: projectItems },
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
  const { orgSlug, projectSlug, project, currentOrg, subject } = context;
  const base = `${projectBasePath(orgSlug, projectSlug)}/ajustes`;

  return (
    <div className={styles.page}>
      <PageHeader title="Ajustes" subtitle={`Proyecto ${project.name}, organización ${currentOrg.name}`} />
      <div className={styles.layout}>
        <SubNav label="Ajustes" groups={ajustesGroups(base, project.name, orgSlug, subject)} />
        <section className={styles.section}>
          <Outlet context={context} />
        </section>
      </div>
    </div>
  );
}
