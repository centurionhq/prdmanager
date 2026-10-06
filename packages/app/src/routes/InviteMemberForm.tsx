/**
 * The "invite by email" form on `/o/:orgSlug/ajustes/miembros` (SDD-006 §Autenticación, WO-118): org
 * role plus optional per-project grants, picked from the org's own projects (SDD-006's invitation
 * contract only accepts `projectId`s that already belong to the organization).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { ORG_ROLES, PROJECT_ROLES, type OrgRole, type ProjectInvitationGrant, type ProjectRole, type ProjectSummary } from '@prdm/contracts';
import { createOrganizationInvitation } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { Button, SelectField, TextField } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import styles from './InviteMemberForm.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface GrantDraft {
  projectId: string;
  enabled: boolean;
  role: ProjectRole;
}

const orgRoleOptions = (roles: readonly OrgRole[]) => roles.map((r) => ({ value: r, label: r }));
const projectRoleOptions = PROJECT_ROLES.map((r) => ({ value: r, label: r }));

export function InviteMemberForm({
  orgSlug,
  projects,
  canInviteOwner,
  onInvited,
  onCancel,
}: {
  orgSlug: string;
  projects: ProjectSummary[];
  /** SDD-006 §Autenticación: "un admin no puede invitar a un nuevo owner" — only an org owner may. */
  canInviteOwner: boolean;
  onInvited: () => void;
  onCancel?: () => void;
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
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <TextField label="Email" type="email" value={email} onChange={setEmail} required error={touched && !emailValid ? 'Ingresá un email válido.' : null} />
      <SelectField label="Rol en la organización" value={role} onChange={(value) => setRole(value as OrgRole)} options={orgRoleOptions(availableRoles)} />

      {projects.length > 0 ? (
        <fieldset className={styles.projects}>
          <legend className={styles.legend}>Acceso a proyectos (opcional)</legend>
          {projects.map((project) => {
            const draft = draftFor(project.id);
            return (
              <div key={project.id} className={styles.project}>
                <label className={styles.check}>
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => updateGrant(project.id, { enabled: e.target.checked })} />
                  <span>{project.name}</span>
                </label>
                {draft.enabled ? (
                  <SelectField label={`Rol en ${project.name}`} hideLabel value={draft.role} onChange={(value) => updateGrant(project.id, { role: value as ProjectRole })} options={projectRoleOptions} />
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      <p className={styles.note}>Le mandamos un enlace de un solo uso que vence en 7 días.</p>
      <FormError message={error} />
      <div className={styles.actions}>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={submitting}>
          Invitar
        </Button>
      </div>
    </form>
  );
}
