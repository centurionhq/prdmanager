/** Shared test fixtures for the new SDD-013 shell/router screens: a full `ProjectOverviewDto` and the
 * `ProjectShellContext` built from it, so every screen under `ProjectShell` can be tested in isolation
 * with `<Outlet context={...}>` instead of going through `ProjectShell`'s own data fetching. */
import { projectSettingsSchema, type OrganizationSummary, type OrgRole, type ProjectOverviewDto, type ProjectRole, type ProjectSettings, type WorkProfile } from '@prdm/contracts';
import type { ProjectShellContext } from '../../src/routes/ProjectShell.js';

export function makeOrgSummary(overrides: Partial<OrganizationSummary> = {}): OrganizationSummary {
  return { id: 'org1', slug: 'acme', name: 'Acme', role: 'owner', ...overrides };
}

export function makeProjectOverview(overrides: Partial<ProjectOverviewDto> = {}): ProjectOverviewDto {
  return {
    id: 'proj1',
    slug: 'web',
    name: 'Web',
    graphProjectId: 'prj_abc',
    settings: projectSettingsSchema.parse({}),
    archivedAt: null,
    docCount: 0,
    furthestStation: 'entrada',
    andonStation: null,
    driftErrors: 0,
    driftWarnings: 0,
    awaitingFirstReport: false,
    workOrdersInProgress: 0,
    myRole: 'viewer',
    lastActivityAt: null,
    ...overrides,
  };
}

export function makeProjectShellContext(
  orgRole: OrgRole,
  myRole: ProjectRole = 'viewer',
  workProfile: WorkProfile | null = null,
  chooseWorkProfile: (profile: WorkProfile) => Promise<void> = async () => undefined,
  /** WO-635: project settings the screen under test reads (e.g. `github_repository` for the commit link).
   * Merged over the schema defaults, so every other field keeps its real shape. */
  settings: Partial<ProjectSettings> = {},
): ProjectShellContext {
  const currentOrg = makeOrgSummary({ role: orgRole });
  const project = makeProjectOverview({ myRole, settings: projectSettingsSchema.parse(settings) });
  return {
    orgSlug: currentOrg.slug,
    organizations: [currentOrg],
    currentOrg,
    projectSlug: project.slug,
    project,
    subject: { orgRole: currentOrg.role, projectRole: myRole },
    workProfile,
    chooseWorkProfile,
  };
}
