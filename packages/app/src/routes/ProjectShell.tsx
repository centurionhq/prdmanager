/**
 * `/o/:orgSlug/p/:projectSlug` (SDD-013 §"Shell y router", ADR-008): resolves the real organization and
 * project from the API (never from constants) and renders the Centurion Factory `AppShell` around every
 * nested screen. Deliberately its own top-level route rather than nested inside `OrgShell` — that keeps
 * `AppShell`'s sidebar as the *only* persistent chrome once a project is selected, instead of stacking it
 * under `OrgShell`'s own header (which stays for the org-level `/o/:orgSlug` routes, before a project is
 * chosen). Its own outlet context is a superset of {@link OrgShellContext}, so every existing screen that
 * already calls `useOrgShellContext()` (`DocumentDetail`, `DriftDashboard`, ...) keeps working unchanged
 * once mounted under this shell instead.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Outlet, useOutletContext, useParams } from 'react-router';
import {
  PROJECT_ROLES,
  type OrganizationSummary,
  type PermissionSubject,
  type ProjectOverviewDto,
  type ProjectRole,
} from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { getProjectsOverview, getSession, listOrganizations } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { AppShell, type AppShellData } from '../components/shell/AppShell.js';
import { projectRoleLabel } from '../components/shell/project-nav.js';
import { FormError } from '../components/FormError.js';
import { FormNotice } from '../components/FormNotice.js';
import type { OrgShellContext } from './OrgShell.js';
import formStyles from '../styles/forms.module.css';

export interface ProjectShellContext extends OrgShellContext {
  projectSlug: string;
  project: ProjectOverviewDto;
  subject: PermissionSubject;
}

/** Nested project screens call this instead of re-fetching the organization/project list themselves. */
export function useProjectShellContext(): ProjectShellContext {
  return useOutletContext<ProjectShellContext>();
}

function asProjectRole(value: string): ProjectRole | undefined {
  return (PROJECT_ROLES as readonly string[]).includes(value) ? (value as ProjectRole) : undefined;
}

interface Loaded {
  organizations: OrganizationSummary[];
  projects: ProjectOverviewDto[];
  personName: string;
}

export function ProjectShell(): ReactElement {
  const { orgSlug, projectSlug } = useParams<{ orgSlug: string; projectSlug: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);

    if (!orgSlug) return undefined;

    Promise.all([listOrganizations(), getProjectsOverview(orgSlug), getSession()])
      .then(([organizations, projects, session]) => {
        if (cancelled) return;
        setLoaded({ organizations, projects, personName: session?.user.name ?? session?.user.email ?? 'Vos' });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug, projectSlug]);

  if (error) {
    return (
      <div className={formStyles.page}>
        <div className={formStyles.card}>
          <FormError message={error} />
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <LoadingState label="Cargando proyecto…" />;
  }

  const currentOrg = loaded.organizations.find((org) => org.slug === orgSlug);
  const project = loaded.projects.find((p) => p.slug === projectSlug);

  if (!currentOrg) {
    return <FormNotice title="Organización no encontrada" subtitle="No pertenecés a esta organización o no existe." />;
  }

  if (!project) {
    return <FormNotice title="Proyecto no encontrado" subtitle="No pertenecés a este proyecto o no existe." />;
  }

  const subject: PermissionSubject = { orgRole: currentOrg.role, projectRole: asProjectRole(project.myRole) };
  const context: ProjectShellContext = {
    orgSlug: currentOrg.slug,
    organizations: loaded.organizations,
    currentOrg,
    projectSlug: project.slug,
    project,
    subject,
  };
  const shellData: AppShellData = {
    orgSlug: currentOrg.slug,
    projectSlug: project.slug,
    orgName: currentOrg.name,
    projectName: project.name,
    personName: loaded.personName,
    personRole: projectRoleLabel(project.myRole),
    driftErrorCount: project.driftErrors,
  };

  return (
    <AppShell data={shellData}>
      <Outlet context={context} />
    </AppShell>
  );
}
