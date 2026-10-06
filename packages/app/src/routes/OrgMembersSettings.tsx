/**
 * `/o/:orgSlug/ajustes/miembros` (SDD-006 §Permisos "Miembros, roles ... auditados", WO-118): member
 * list with role changes/removal, invite-by-email (`InviteMemberForm`) and pending-invitation
 * list/revoke. Mutating controls are gated to org owners/admins client-side (`isOrgAdmin`) purely for UX
 * — every mutation still goes through the real `/api/app/organizations/:orgSlug/*` routes, which enforce
 * it again server-side and reject (surfaced here as a normal form error) a rule this screen doesn't even
 * try to pre-empt, like removing the organization's last owner.
 *
 * WO-363 additions: a "Proyectos" column (how many of the org's own projects each member actually has a
 * `project_members` row in — there's no batch endpoint for this yet, so it's `listProjectMembers` once
 * per project and counted client-side, fine at this screen's scale), blocking self-removal the same way
 * `ProjectMembersSection` does, and a "Reenviar" action on pending invitations (`resendInvitation`,
 * WO-343) with its own short-lived confirmation banner.
 *
 * SDD-056/PRD-036: rebuilt on the design-system pieces (`PageHeader`, `DataTable`, `Modal`, `SelectField`,
 * `Button`). It lives in `OrgShell`, not under the project's Ajustes layout, so it keeps its own `h1`. Same
 * requests, same rules; the invite form opens from the primary action instead of sitting under the tables.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ORG_ROLES, type AccessRequest, type InvitationSummary, type OrganizationMember, type OrgRole, type ProjectSummary } from '@prdm/contracts';
import {
  approveAccessRequest,
  getSession,
  listAccessRequests,
  listOrganizationInvitations,
  listOrganizationMembers,
  listProjectMembers,
  listProjects,
  rejectAccessRequest,
  removeOrganizationMember,
  resendInvitation,
  revokeOrganizationInvitation,
  updateOrganizationMemberRole,
} from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { isOrgAdmin } from '../auth/org-role.js';
import { Button, DataTable, Modal, Notice, PageHeader, SelectField, Skeleton, type DataTableColumn } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { formatDate, formatDateTime } from '../lib/format-date.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { InviteMemberForm } from './InviteMemberForm.js';
import { useOrgShellContext } from './OrgShell.js';
import { PersonCell } from './miembros/PersonCell.js';
import styles from './OrgMembersSettings.module.css';

interface Loaded {
  members: OrganizationMember[];
  invitations: InvitationSummary[];
  accessRequests: AccessRequest[];
  projects: ProjectSummary[];
  projectCountByUserId: Map<string, number>;
  currentUserId: string | null;
}

async function countProjectsByMember(orgSlug: string, projects: ProjectSummary[]): Promise<Map<string, number>> {
  const memberLists = await Promise.all(projects.map((project) => listProjectMembers(orgSlug, project.slug)));
  const counts = new Map<string, number>();
  for (const members of memberLists) {
    for (const member of members) {
      counts.set(member.userId, (counts.get(member.userId) ?? 0) + 1);
    }
  }
  return counts;
}

export function OrgMembersSettings(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  const canManage = isOrgAdmin(currentOrg.role);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<AccessRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  useDocumentTitle(`Miembros de ${currentOrg.name}`);

  async function reload(): Promise<void> {
    try {
      const [members, invitations, accessRequests, projects, session] = await Promise.all([
        listOrganizationMembers(orgSlug),
        canManage ? listOrganizationInvitations(orgSlug) : Promise.resolve([]),
        canManage ? listAccessRequests(orgSlug) : Promise.resolve([]),
        listProjects(orgSlug),
        getSession(),
      ]);
      const projectCountByUserId = await countProjectsByMember(orgSlug, projects);
      setData({ members, invitations, accessRequests, projects, projectCountByUserId, currentUserId: session?.user.id ?? null });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function showToast(message: string): void {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
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

  async function handleResend(invitationId: string): Promise<void> {
    setRowError(null);
    try {
      await resendInvitation(orgSlug, invitationId);
      showToast('Invitación reenviada');
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  async function handleApprove(request: AccessRequest): Promise<void> {
    setRowError(null);
    try {
      const result = await approveAccessRequest(orgSlug, request.id);
      showToast(result?.alreadyMember === true ? `${request.email} ya es miembro: no se creó una invitación nueva.` : `Invitación enviada a ${request.email}`);
      await reload();
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  function closeRejectDialog(): void {
    setRejectTarget(null);
    setRejectReason('');
  }

  async function handleReject(): Promise<void> {
    if (!rejectTarget) return;
    setRowError(null);
    try {
      await rejectAccessRequest(orgSlug, rejectTarget.id, rejectReason.trim() || undefined);
      closeRejectDialog();
      await reload();
    } catch (err) {
      closeRejectDialog();
      setRowError(errorMessage(err));
    }
  }

  if (error) return <FormError message={error} />;
  if (!data) return <Skeleton rows={4} />;

  const ROLE_OPTIONS = ORG_ROLES.map((r) => ({ value: r, label: r }));

  const memberColumns: readonly DataTableColumn<OrganizationMember>[] = [
    { key: 'person', header: 'Persona', render: (member) => <PersonCell name={member.name} email={member.email} you={member.userId === data.currentUserId} />, sortValue: (member) => member.name },
    {
      key: 'role',
      header: 'Rol',
      render: (member) =>
        canManage ? (
          <SelectField label={`Rol de ${member.email}`} hideLabel value={member.role} options={ROLE_OPTIONS} onChange={(value) => void handleRoleChange(member.userId, value as OrgRole)} />
        ) : (
          member.role
        ),
    },
    { key: 'projects', header: 'Proyectos', align: 'end', render: (member) => data.projectCountByUserId.get(member.userId) ?? 0 },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Acciones',
            align: 'end' as const,
            render: (member: OrganizationMember) =>
              member.userId === data.currentUserId ? (
                <span className={styles.cannotRemove}>No podés quitarte</span>
              ) : (
                <Button type="button" variant="destructive" size="sm" aria-label={`Quitar a ${member.email}`} onClick={() => void handleRemove(member.userId)}>
                  Quitar
                </Button>
              ),
          },
        ]
      : []),
  ];

  const invitationColumns: readonly DataTableColumn<InvitationSummary>[] = [
    { key: 'email', header: 'Email', render: (invitation) => invitation.email },
    { key: 'role', header: 'Rol', render: (invitation) => invitation.role },
    { key: 'status', header: 'Estado', render: (invitation) => invitation.status },
    { key: 'expires', header: 'Vence', render: (invitation) => formatDate(invitation.expiresAt) },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'end',
      render: (invitation) => (
        <span className={styles.rowActions}>
          {invitation.status === 'pending' ? (
            <Button type="button" variant="ghost" size="sm" aria-label={`Reenviar a ${invitation.email}`} onClick={() => void handleResend(invitation.id)}>
              Reenviar
            </Button>
          ) : null}
          <Button type="button" variant="destructive" size="sm" aria-label={`Revocar la invitación de ${invitation.email}`} onClick={() => void handleRevoke(invitation.id)}>
            Revocar
          </Button>
        </span>
      ),
    },
  ];

  const accessRequestColumns: readonly DataTableColumn<AccessRequest>[] = [
    { key: 'person', header: 'Persona', render: (r) => (r.name ? `${r.name} · ${r.email}` : r.email), sortValue: (r) => r.email },
    { key: 'message', header: 'Mensaje', render: (r) => r.message ?? 'Sin mensaje' },
    { key: 'createdAt', header: 'Cuándo', render: (r) => formatDateTime(r.createdAt) },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'end',
      render: (r) => (
        <span className={styles.rowActions}>
          <Button type="button" variant="primary" size="sm" aria-label={`Aprobar la solicitud de ${r.email}`} onClick={() => void handleApprove(r)}>
            Aprobar
          </Button>
          <Button type="button" variant="destructive" size="sm" aria-label={`Rechazar la solicitud de ${r.email}`} onClick={() => setRejectTarget(r)}>
            Rechazar
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className={styles.screen}>
      <PageHeader
        title={`Miembros de ${currentOrg.name}`}
        subtitle="Quién es parte de la organización y a qué proyectos accede."
        actions={
          canManage ? (
            <Button type="button" variant="primary" onClick={() => setInviting(true)}>
              Invitar persona
            </Button>
          ) : undefined
        }
      />
      <FormError message={rowError} />
      <DataTable caption="Miembros de la organización" columns={memberColumns} rows={data.members} getRowId={(member) => member.userId} />

      {canManage ? (
        <>
          <section className={styles.invitations} aria-labelledby="org-invitations-title">
            <h2 id="org-invitations-title" className={styles.sectionTitle}>
              Invitaciones pendientes
            </h2>
            {data.invitations.length === 0 ? (
              <p className={styles.empty}>No hay invitaciones pendientes.</p>
            ) : (
              <DataTable caption="Invitaciones pendientes" columns={invitationColumns} rows={data.invitations} getRowId={(invitation) => invitation.id} />
            )}
          </section>

          <section className={styles.accessRequests} aria-labelledby="org-access-requests-title">
            <h2 id="org-access-requests-title" className={styles.sectionTitle}>
              Solicitudes de acceso
            </h2>
            {data.accessRequests.length === 0 ? (
              <p className={styles.empty}>No hay solicitudes de acceso pendientes.</p>
            ) : (
              <DataTable caption="Solicitudes de acceso" columns={accessRequestColumns} rows={data.accessRequests} getRowId={(r) => r.id} />
            )}
          </section>

          <Modal
            open={rejectTarget !== null}
            title="Rechazar solicitud"
            description={rejectTarget ? `La solicitud de ${rejectTarget.email} no va a generar una invitación.` : undefined}
            onClose={closeRejectDialog}
            footer={
              <>
                <Button type="button" variant="secondary" onClick={closeRejectDialog}>
                  Cancelar
                </Button>
                <Button type="button" variant="destructive" onClick={() => void handleReject()}>
                  Rechazar
                </Button>
              </>
            }
          >
            <div className={styles.field}>
              <label htmlFor="reject-reason">Motivo (opcional)</label>
              <textarea id="reject-reason" className={styles.textarea} maxLength={500} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </div>
          </Modal>

          <Modal open={inviting} title="Invitar miembro" description="Le mandamos un enlace para que se sume a la organización." onClose={() => setInviting(false)}>
            <InviteMemberForm
              orgSlug={orgSlug}
              projects={data.projects}
              canInviteOwner={currentOrg.role === 'owner'}
              onInvited={() => {
                setInviting(false);
                void reload();
              }}
              onCancel={() => setInviting(false)}
            />
          </Modal>
        </>
      ) : null}

      {toast ? (
        <div role="status">
          <Notice>{toast}</Notice>
        </div>
      ) : null}
    </div>
  );
}
