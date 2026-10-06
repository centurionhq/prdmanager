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
  workProfileSchema,
  type WorkProfile,
} from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { getProfile, getProjectsOverview, getSession, listOrganizations, setWorkProfile } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { AppShell, type AppShellData } from '../components/shell/AppShell.js';
import { projectRoleLabel } from '../components/shell/project-nav.js';
import { FormError } from '../components/FormError.js';
import { FormNotice } from '../components/FormNotice.js';
import { NotFoundPanel } from '../components/NotFoundPanel/NotFoundPanel.js';
import type { OrgShellContext } from './OrgShell.js';
import formStyles from '../styles/forms.module.css';

export interface ProjectShellContext extends OrgShellContext {
  projectSlug: string;
  project: ProjectOverviewDto;
  subject: PermissionSubject;
  /** WO-544 (SDD-051): the way of working this person picked on the Planta's entry band. `null` means they
   * have not chosen yet, which the band renders on purpose (it asks) -- never a default to guess. It is a
   * routing preference and nothing authorizes off it: `subject` above is still the only thing `can()` sees. */
  workProfile: WorkProfile | null;
  /** Picks a profile. Updates immediately and puts the previous one back (rethrowing) if the server
   * refuses, so the band never shows a choice that was not actually kept. */
  chooseWorkProfile: (profile: WorkProfile) => Promise<void>;
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

/** The profile is a UX preference, so failing to read it must not take the whole project down with it:
 * it degrades to "has not chosen", and the entry band simply asks again. Everything else the shell loads
 * is load-bearing and still fails loudly.
 *
 * The answer is *validated*, not trusted: a server still on the previous release answers without the field
 * at all (`undefined`, which is not the `null` the band treats as "ask"), and a newer one could send a value
 * this build has no copy for. Both mean "not chosen". Trusting the type here is what took the whole Planta
 * down in production the day this shipped ahead of the server. */
function loadWorkProfile(): Promise<WorkProfile | null> {
  return getProfile().then(
    (profile) => {
      const parsed = workProfileSchema.safeParse(profile.workProfile);
      return parsed.success ? parsed.data : null;
    },
    () => null,
  );
}

export function ProjectShell(): ReactElement {
  const { orgSlug, projectSlug } = useParams<{ orgSlug: string; projectSlug: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workProfile, setWorkProfileState] = useState<WorkProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);

    if (!orgSlug) return undefined;

    // WO-544: the profile is a fourth member of the *same* Promise.all that already gates this whole
    // subtree behind `LoadingState`. That is the point: the entry band never mounts before it knows the
    // profile, so there is no intermediate state of its own to draw, and no extra round trip in series.
    Promise.all([listOrganizations(), getProjectsOverview(orgSlug), getSession(), loadWorkProfile()])
      .then(([organizations, projects, session, profile]) => {
        if (cancelled) return;
        setWorkProfileState(profile);
        setLoaded({ organizations, projects, personName: session?.user.name ?? session?.user.email ?? 'Vos' });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug, projectSlug]);

  async function chooseWorkProfile(next: WorkProfile): Promise<void> {
    const previous = workProfile;
    setWorkProfileState(next);
    try {
      await setWorkProfile({ workProfile: next });
    } catch (err) {
      setWorkProfileState(previous);
      throw err;
    }
  }

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
    return (
      <NotFoundPanel
        brand="Centurion Factory"
        title="Proyecto no encontrado"
        body="No pertenecés a este proyecto o no existe."
        action={{ to: `/o/${currentOrg.slug}`, label: `Ver los proyectos de ${currentOrg.name}` }}
      />
    );
  }

  const subject: PermissionSubject = { orgRole: currentOrg.role, projectRole: asProjectRole(project.myRole) };
  const context: ProjectShellContext = {
    orgSlug: currentOrg.slug,
    organizations: loaded.organizations,
    currentOrg,
    projectSlug: project.slug,
    project,
    subject,
    workProfile,
    chooseWorkProfile,
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
