/**
 * `/o/:orgSlug/settings/members` (SDD-006 §Permisos "Miembros, roles ... auditados", WO-118): member
 * list with role changes/removal, invite-by-email (`InviteMemberForm`) and pending-invitation
 * list/revoke. Mutating controls are gated to org owners/admins client-side (`isOrgAdmin`) purely for UX
 * — every mutation still goes through the real `/api/app/organizations/:orgSlug/*` routes, which enforce
 * it again server-side and reject (surfaced here as a normal form error) a rule this screen doesn't even
 * try to pre-empt, like removing the organization's last owner.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ORG_ROLES, type InvitationSummary, type OrganizationMember, type OrgRole, type ProjectSummary } from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import {
  listOrganizationInvitations,
  listOrganizationMembers,
  listProjects,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  updateOrganizationMemberRole,
} from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { isOrgAdmin } from '../auth/org-role.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { InviteMemberForm } from './InviteMemberForm.js';
import { useOrgShellContext } from './OrgShell.js';
import formStyles from '../styles/forms.module.css';

interface Loaded {
  members: OrganizationMember[];
  invitations: InvitationSummary[];
  projects: ProjectSummary[];
}

export function OrgMembersSettings(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  const canManage = isOrgAdmin(currentOrg.role);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  useDocumentTitle(`Miembros de ${currentOrg.name}`);

  async function reload(): Promise<void> {
    try {
      const [members, invitations, projects] = await Promise.all([
        listOrganizationMembers(orgSlug),
        canManage ? listOrganizationInvitations(orgSlug) : Promise.resolve([]),
        listProjects(orgSlug),
      ]);
      setData({ members, invitations, projects });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    setData(null);
    setError(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  async function handleRoleChange(userId: string, role: OrgRole): Promise<void> {
    setRowError(null);
    try {
      await updateOrganizationMemberRole(orgSlug, userId, role);
      await reload();
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  async function handleRemove(userId: string): Promise<void> {
    setRowError(null);
    try {
      await removeOrganizationMember(orgSlug, userId);
      await reload();
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  async function handleRevoke(invitationId: string): Promise<void> {
    setRowError(null);
    try {
      await revokeOrganizationInvitation(orgSlug, invitationId);
      await reload();
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  if (error) return <FormError message={error} />;
  if (!data) return <LoadingState label="Cargando miembros…" />;

  return (
    <div>
      <h1 className={formStyles.title}>Miembros de {currentOrg.name}</h1>
      <FormError message={rowError} />
      <div className={formStyles.tableWrap}>
        <table className={formStyles.table}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Nombre</th>
              <th>Rol</th>
              {canManage && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {data.members.map((member) => (
              <tr key={member.userId}>
                <td>{member.email}</td>
                <td>{member.name}</td>
                <td>
                  {canManage ? (
                    <select aria-label={`Rol de ${member.email}`} value={member.role} onChange={(e) => void handleRoleChange(member.userId, e.target.value as OrgRole)}>
                      {ORG_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    member.role
                  )}
                </td>
                {canManage && (
                  <td>
                    <button type="button" className={formStyles.secondaryButton} onClick={() => void handleRemove(member.userId)}>
                      Quitar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <>
          <h2 className={formStyles.title}>Invitaciones pendientes</h2>
          {data.invitations.length === 0 && <p className={formStyles.hint}>No hay invitaciones pendientes.</p>}
          {data.invitations.length > 0 && (
            <div className={formStyles.tableWrap}>
              <table className={formStyles.table}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Vence</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>{invitation.email}</td>
                      <td>{invitation.role}</td>
                      <td>{invitation.status}</td>
                      <td>{invitation.expiresAt}</td>
                      <td>
                        <button type="button" className={formStyles.secondaryButton} onClick={() => void handleRevoke(invitation.id)}>
                          Revocar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <InviteMemberForm orgSlug={orgSlug} projects={data.projects} canInviteOwner={currentOrg.role === 'owner'} onInvited={() => void reload()} />
        </>
      )}
    </div>
  );
}
