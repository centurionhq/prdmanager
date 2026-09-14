/**
 * The members table + "add member" form on `/o/:orgSlug/p/:projectSlug/settings` (SDD-006 §Permisos,
 * WO-118): a project member is always chosen from the organization's own members (`addProjectMemberInput`
 * takes a `userId`, not an email — there is no separate "invite to a project" flow, only org invitations
 * that may carry project grants, WO-105).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { PROJECT_ROLES, type OrganizationMember, type ProjectMemberDto, type ProjectRole } from '@prdm/contracts';
import { addProjectMember, removeProjectMember, updateProjectMemberRole } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import styles from '../styles/forms.module.css';

export function ProjectMembersSection({
  orgSlug,
  projectSlug,
  members,
  orgMembers,
  canManage,
  onChanged,
}: {
  orgSlug: string;
  projectSlug: string;
  members: ProjectMemberDto[];
  orgMembers: OrganizationMember[];
  canManage: boolean;
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
                  <button type="button" className={styles.secondaryButton} onClick={() => void handleRemove(member.userId)}>
                    Quitar
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

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
    </div>
  );
}
