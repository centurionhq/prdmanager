/**
 * `/o/:orgSlug/p/:projectSlug/settings` (SDD-006 §Permisos, WO-118+WO-119): the caller's *effective*
 * project role (`@prdm/contracts`'s `can()`, the same rule the server uses — "owner y admin de
 * organización heredan admin de proyecto") gates both the members section and the CI-tokens section.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router';
import { can, type OrganizationMember, type PermissionSubject, type ProjectMemberDto, type ProjectSummary } from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { getProject, getSession, listOrganizationMembers, listProjectMembers } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { CiTokensSection } from './CiTokensSection.js';
import { useOrgShellContext } from './OrgShell.js';
import { ProjectMembersSection } from './ProjectMembersSection.js';
import formStyles from '../styles/forms.module.css';

interface Loaded {
  project: ProjectSummary;
  members: ProjectMemberDto[];
  orgMembers: OrganizationMember[];
  subject: PermissionSubject;
}

export function ProjectSettings(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(data ? data.project.name : 'Proyecto');

  async function reload(): Promise<void> {
    if (!projectSlug) return;
    try {
      const [session, project, members, orgMembers] = await Promise.all([
        getSession(),
        getProject(orgSlug, projectSlug),
        listProjectMembers(orgSlug, projectSlug),
        listOrganizationMembers(orgSlug),
      ]);
      const own = session ? members.find((m) => m.userId === session.user.id) : undefined;
      setData({ project, members, orgMembers, subject: { orgRole: currentOrg.role, projectRole: own?.role } });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    setData(null);
    setError(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, projectSlug]);

  if (error) return <FormError message={error} />;
  if (!data || !projectSlug) return <LoadingState label="Cargando proyecto…" />;

  const canManageMembers = can(data.subject, 'manage_members');
  const canManageCiTokens = can(data.subject, 'manage_ci_tokens');

  return (
    <div>
      <h1 className={formStyles.title}>{data.project.name}</h1>
      <p className={formStyles.subtitle}>{data.project.slug}</p>
      <ProjectMembersSection
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        members={data.members}
        orgMembers={data.orgMembers}
        canManage={canManageMembers}
        onChanged={() => void reload()}
      />
      {canManageCiTokens && <CiTokensSection orgSlug={orgSlug} projectSlug={projectSlug} />}
    </div>
  );
}
