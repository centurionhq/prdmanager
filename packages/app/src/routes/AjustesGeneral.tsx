/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/general` (SDD-013 §"Shell y router"): read-only project identity
 * plus the one field of `.prdm.yaml`-backed settings this dashboard already exposes end-to-end —
 * `default_branch` (SDD-006 §Modelo de datos, `updateProjectSettings`, WO-107) — since the CI-tokens
 * screen's own note (WO-364) now points here for "which branch does the official baseline follow".
 * Every other `projectSettingsSchema` field (folders, git, triage, lifecycle, ignore, GitHub linkage)
 * stays out of this form deliberately: there's no dedicated canvas for a full settings editor yet, and
 * "no inventes campos nuevos" means this WO doesn't design one from scratch.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { updateProjectSettings } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { IdTag } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import styles from '../styles/forms.module.css';

export function AjustesGeneral(): ReactElement {
  const { orgSlug, projectSlug, project, currentOrg } = useProjectShellContext();
  const [defaultBranch, setDefaultBranch] = useState(project.settings.default_branch);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useDocumentTitle('Ajustes · general');

  const branchValid = defaultBranch.trim().length > 0;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!branchValid) return;

    setSubmitting(true);
    try {
      const updated = await updateProjectSettings(orgSlug, projectSlug, {
        settings: { ...project.settings, default_branch: defaultBranch.trim() },
      });
      setDefaultBranch(updated.settings.default_branch);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className={styles.title}>{project.name}</h2>
      <p className={styles.subtitle}>
        <IdTag id={project.slug} /> · organización {currentOrg.name}
      </p>

      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="general-default-branch">Rama por defecto</label>
          <input
            id="general-default-branch"
            type="text"
            required
            value={defaultBranch}
            aria-invalid={!branchValid}
            onChange={(e) => setDefaultBranch(e.target.value)}
          />
          <span className={styles.hint}>La baseline oficial de drift se calcula sobre esta rama.</span>
        </div>
        <FormError message={error} />
        {saved && <p className={styles.success}>Guardado.</p>}
        <div className={styles.actions}>
          <button type="submit" className={styles.primaryButton} disabled={submitting || !branchValid}>
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
