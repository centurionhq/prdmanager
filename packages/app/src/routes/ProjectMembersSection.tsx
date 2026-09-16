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
import { FormError } from '../components/FormError.js';
import styles from '../styles/forms.module.css';

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

function RoleMatrix(): ReactElement {
  return (
    <div>
      <h3 className={styles.title}>Qué puede hacer cada rol</h3>
      <p className={styles.hint}>Cada persona tiene un solo rol en este proyecto. Solo un admin puede cambiarlo.</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th />
              {PROJECT_ROLES.map((role) => (
                <th key={role}>{role}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_MATRIX_ROWS.map((row) => (
              <tr key={row.action}>
                <th scope="row">{row.label}</th>
                {PROJECT_ROLES.map((role) => (
                  <td key={role}>{can({ projectRole: role }, row.action) ? 'Sí' : 'No'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
      onChanged();
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <h2 className={styles.title}>Miembros del proyecto</h2>
      <FormError message={rowError} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Nombre</th>
              <th>Rol</th>
              {canManage && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td>{member.email}</td>
                <td>{member.name}</td>
                <td>
                  {canManage ? (
                    <select
                      aria-label={`Rol de ${member.email}`}
                      value={member.role}
                      onChange={(e) => void handleRoleChange(member.userId, e.target.value as ProjectRole)}
                    >
                      {PROJECT_ROLES.map((r) => (
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
                    {member.userId === currentUserId ? (
                      <span className={styles.hint}>No podés quitarte</span>
                    ) : (
                      <button type="button" className={styles.secondaryButton} onClick={() => void handleRemove(member.userId)}>
                        Quitar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && candidates.length > 0 && (
        <form className={styles.card} onSubmit={handleAdd} noValidate>
          <h3 className={styles.title}>Agregar miembro</h3>
          <div className={styles.field}>
            <label htmlFor="add-member-user">Miembro de la organización</label>
            <select id="add-member-user" value={addUserId} onChange={(e) => setAddUserId(e.target.value)} required>
              <option value="" disabled>
                Elegí un miembro
              </option>
              {candidates.map((om) => (
                <option key={om.userId} value={om.userId}>
                  {om.email}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="add-member-role">Rol</label>
            <select id="add-member-role" value={addRole} onChange={(e) => setAddRole(e.target.value as ProjectRole)}>
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <FormError message={addError} />
          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton} disabled={adding || !addUserId}>
              Agregar
            </button>
          </div>
        </form>
      )}

      <RoleMatrix />
    </div>
  );
}
