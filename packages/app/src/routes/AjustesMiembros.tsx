/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/miembros` (SDD-006 §Permisos, ported off the old combined
 * `ProjectSettings.tsx` into its own ajustes screen, SDD-013 §"Shell y router"): the project members
 * table + "add member" form, gated by `can(subject, 'manage_members')` — `subject` comes straight from
 * `ProjectShell`'s own `myRole`-derived permission subject, so no extra self-membership lookup is needed
 * here (unlike the old screen, which re-derived it from `listProjectMembers()` itself).
 *
 * WO-363: also fetches the caller's own session (`getSession`, `ProjectShell`'s own context carries no
 * user id) purely so `ProjectMembersSection` can block removing yourself from the table.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { can, type OrganizationMember, type ProjectMemberDto } from '@prdm/contracts';
import { getSession, listOrganizationMembers, listProjectMembers } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { Skeleton } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { ProjectMembersSection } from './ProjectMembersSection.js';
import { useProjectShellContext } from './ProjectShell.js';

interface Loaded {
  members: ProjectMemberDto[];
  orgMembers: OrganizationMember[];
  currentUserId: string | null;
}

export function AjustesMiembros(): ReactElement {
  const { orgSlug, projectSlug, subject } = useProjectShellContext();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('Ajustes · miembros');

  async function reload(): Promise<void> {
    try {
      const [members, orgMembers, session] = await Promise.all([
        listProjectMembers(orgSlug, projectSlug),
        listOrganizationMembers(orgSlug),
        getSession(),
      ]);
      setData({ members, orgMembers, currentUserId: session?.user.id ?? null });
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
  if (!data) return <Skeleton rows={4} />;

  return (
    <ProjectMembersSection
      orgSlug={orgSlug}
      projectSlug={projectSlug}
      members={data.members}
      orgMembers={data.orgMembers}
      canManage={can(subject, 'manage_members')}
      currentUserId={data.currentUserId}
      onChanged={() => void reload()}
    />
  );
}
