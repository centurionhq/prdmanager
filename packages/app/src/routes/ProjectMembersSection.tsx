/**
 * The members table + "add member" form on `/o/:orgSlug/p/:projectSlug/settings` (SDD-006 §Permisos,
 * WO-118): a project member is always chosen from the organization's own members (`addProjectMemberInput`
 * takes a `userId`, not an email — there is no separate "invite to a project" flow, only org invitations
 * that may carry project grants, WO-105).
 *
 * WO-363 additions: nobody can remove themselves from the table (`currentUserId`, mirroring the canvas's
 * "No podés quitarte" — the server would reject it anyway via its own last-admin-style checks, this is
 * purely a clearer client-side affordance) and a static "qué puede hacer cada rol" matrix, derived
 * straight from `@prdm/contracts`'s own `can()`/`PERMISSION_MATRIX` rather than a hand-kept copy of it.
 *
 * SDD-056/PRD-036: rebuilt on the design-system pieces against `AjustesMiembros.dc.html`: `SectionHeader` with
 * the primary action, `DataTable`, and the add form in a `Modal`. Same requests, same rules.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  can,
  PROJECT_ROLES,
  type OrganizationMember,
  type PermissionAction,
  type ProjectMemberDto,
  type ProjectRole,
} from '@prdm/contracts';
import { addProjectMember, removeProjectMember, updateProjectMemberRole } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { Button, DataTable, Modal, SectionHeader, SelectField, type DataTableColumn } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { PersonCell } from './miembros/PersonCell.js';
import styles from './ProjectMembersSection.module.css';

/** SDD-006 §Permisos row labels worth surfacing on this screen, in the same order as the canvas's own
 * "Qué puede hacer cada rol" table — a curated subset of `PERMISSION_ACTIONS`, not every row in the SDD. */
const ROLE_MATRIX_ROWS: readonly { label: string; action: PermissionAction }[] = [
  { label: 'Ver', action: 'view' },
  { label: 'Comentar', action: 'comment' },
  { label: 'Editar documentos', action: 'edit_document' },
  { label: 'Publicar', action: 'publish' },
  { label: 'Tomar órdenes', action: 'claim_work_order' },
  { label: 'Reconocer drift', action: 'acknowledge_drift' },
  { label: 'Cerrar feature', action: 'close_feature' },
  { label: 'Gestionar miembros', action: 'manage_members' },
];

const ROLE_OPTIONS = PROJECT_ROLES.map((role) => ({ value: role, label: role }));

type MatrixRow = (typeof ROLE_MATRIX_ROWS)[number];

const MATRIX_COLUMNS: readonly DataTableColumn<MatrixRow>[] = [
  { key: 'action', header: 'Acción', render: (row) => row.label },
  ...PROJECT_ROLES.map(
    (role): DataTableColumn<MatrixRow> => ({
      key: role,
      header: role,
      align: 'end',
      render: (row) => (can({ projectRole: role }, row.action) ? 'Sí' : 'No'),
    }),
  ),
];

function RoleMatrix(): ReactElement {
  return (
    <section className={styles.matrix} aria-labelledby="role-matrix-title">
      <div className={styles.matrixHeading}>
        <h3 id="role-matrix-title" className={styles.matrixTitle}>
          Qué puede hacer cada rol
        </h3>
        <p className={styles.matrixHint}>Cada persona tiene un solo rol en este proyecto. Solo un admin puede cambiarlo.</p>
      </div>
      <DataTable caption="Qué puede hacer cada rol" columns={MATRIX_COLUMNS} rows={ROLE_MATRIX_ROWS} getRowId={(row) => row.action} />
    </section>
  );
}

export function ProjectMembersSection({
  orgSlug,
  projectSlug,
  members,
  orgMembers,
  canManage,
  currentUserId,
  onChanged,
}: {
  orgSlug: string;
  projectSlug: string;
  members: ProjectMemberDto[];
  orgMembers: OrganizationMember[];
  canManage: boolean;
  currentUserId: string | null;
  onChanged: () => void;
}): ReactElement {
  const [rowError, setRowError] = useState<string | null>(null);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<ProjectRole>('viewer');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const candidates = orgMembers.filter((om) => !members.some((m) => m.userId === om.userId));

  async function handleRoleChange(userId: string, role: ProjectRole): Promise<void> {
    setRowError(null);
    try {
      await updateProjectMemberRole(orgSlug, projectSlug, userId, role);
      onChanged();
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  async function handleRemove(userId: string): Promise<void> {
    setRowError(null);
    try {
      await removeProjectMember(orgSlug, projectSlug, userId);
      onChanged();
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  async function handleAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAddError(null);
    if (!addUserId) return;

    setAdding(true);
    try {
      await addProjectMember(orgSlug, projectSlug, { userId: addUserId, role: addRole });
      setAddUserId('');
      setAddRole('viewer');
      setDialogOpen(false);
      onChanged();
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  const columns: readonly DataTableColumn<ProjectMemberDto>[] = [
    { key: 'person', header: 'Persona', render: (member) => <PersonCell name={member.name} email={member.email} you={member.userId === currentUserId} />, sortValue: (member) => member.name },
    {
      key: 'role',
      header: 'Rol',
      render: (member) =>
        canManage ? (
          <SelectField label={`Rol de ${member.email}`} hideLabel value={member.role} options={ROLE_OPTIONS} onChange={(value) => void handleRoleChange(member.userId, value as ProjectRole)} />
        ) : (
          member.role
        ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Acciones',
            align: 'end' as const,
            render: (member: ProjectMemberDto) =>
              member.userId === currentUserId ? (
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

  return (
    <div className={styles.screen}>
      <SectionHeader
        title="Miembros del proyecto"
        subtitle="Quién puede ver, editar, publicar y reconocer drift en este proyecto."
        actions={
          canManage && candidates.length > 0 ? (
            <Button type="button" variant="primary" onClick={() => setDialogOpen(true)}>
              Agregar miembro
            </Button>
          ) : null
        }
      />
      <FormError message={rowError} />
      <DataTable caption="Miembros del proyecto" columns={columns} rows={members} getRowId={(member) => member.userId} />

      {canManage && candidates.length > 0 ? (
        <Modal open={dialogOpen} title="Agregar miembro" description="Elegí a alguien de la organización y el rol que tendrá en este proyecto." onClose={() => setDialogOpen(false)}>
          <form className={styles.form} onSubmit={handleAdd} noValidate>
            <SelectField
              label="Miembro de la organización"
              value={addUserId}
              onChange={setAddUserId}
              options={[{ value: '', label: 'Elegí un miembro' }, ...candidates.map((om) => ({ value: om.userId, label: om.email }))]}
            />
            <SelectField label="Rol" value={addRole} onChange={(value) => setAddRole(value as ProjectRole)} options={ROLE_OPTIONS} />
            <FormError message={addError} />
            <div className={styles.actions}>
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={adding || !addUserId}>
                Agregar
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      <RoleMatrix />
    </div>
  );
}
