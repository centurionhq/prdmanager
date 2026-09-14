/**
 * The "invite by email" form on `/o/:orgSlug/settings/members` (SDD-006 §Autenticación, WO-118): org
 * role plus optional per-project grants, picked from the org's own projects (SDD-006's invitation
 * contract only accepts `projectId`s that already belong to the organization).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { ORG_ROLES, PROJECT_ROLES, type OrgRole, type ProjectInvitationGrant, type ProjectRole, type ProjectSummary } from '@prdm/contracts';
import { createOrganizationInvitation } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import styles from '../styles/forms.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface GrantDraft {
  projectId: string;
  enabled: boolean;
  role: ProjectRole;
}

export function InviteMemberForm({
  orgSlug,
  projects,
  canInviteOwner,
  onInvited,
}: {
  orgSlug: string;
  projects: ProjectSummary[];
  /** SDD-006 §Autenticación: "un admin no puede invitar a un nuevo owner" — only an org owner may. */
  canInviteOwner: boolean;
  onInvited: () => void;
}): ReactElement {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [grants, setGrants] = useState<Record<string, GrantDraft>>({});
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = EMAIL_PATTERN.test(email);
  const availableRoles = ORG_ROLES.filter((r) => r !== 'owner' || canInviteOwner);

  function draftFor(projectId: string): GrantDraft {
    return grants[projectId] ?? { projectId, enabled: false, role: 'viewer' };
  }

  function updateGrant(projectId: string, patch: Partial<GrantDraft>): void {
    setGrants((prev) => ({ ...prev, [projectId]: { ...draftFor(projectId), ...patch } }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!emailValid) return;

    const projectGrants: ProjectInvitationGrant[] = Object.values(grants)
      .filter((g) => g.enabled)
      .map((g) => ({ projectId: g.projectId, role: g.role }));

    setSubmitting(true);
    try {
      await createOrganizationInvitation(orgSlug, { email, role, projectGrants: projectGrants.length > 0 ? projectGrants : undefined });
      setEmail('');
      setRole('member');
      setGrants({});
      setTouched(false);
      onInvited();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit} noValidate>
      <h2 className={styles.title}>Invitar miembro</h2>
      <div className={styles.field}>
        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" type="email" required value={email} data-touched={touched} onChange={(e) => setEmail(e.target.value)} />
        {touched && !emailValid && <span className={styles.hint}>Ingresá un email válido.</span>}
      </div>
      <div className={styles.field}>
        <label htmlFor="invite-role">Rol en la organización</label>
        <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
          {availableRoles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      {projects.length > 0 && (
        <fieldset className={styles.field}>
          <legend>Acceso a proyectos (opcional)</legend>
          {projects.map((project) => {
            const draft = draftFor(project.id);
            return (
              <div key={project.id} className={styles.field}>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => updateGrant(project.id, { enabled: e.target.checked })}
                  />{' '}
                  {project.name}
                </label>
                {draft.enabled && (
                  <select
                    aria-label={`Rol en ${project.name}`}
                    value={draft.role}
                    onChange={(e) => updateGrant(project.id, { role: e.target.value as ProjectRole })}
                  >
                    {PROJECT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      <FormError message={error} />
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} disabled={submitting}>
          Invitar
        </button>
      </div>
    </form>
  );
}
