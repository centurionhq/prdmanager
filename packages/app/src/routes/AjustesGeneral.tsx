/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/general` (SDD-013 §"Shell y router"): read-only project identity
 * plus the one field of `.prdm.yaml`-backed settings this dashboard already exposes end-to-end —
 * `default_branch` (SDD-006 §Modelo de datos, `updateProjectSettings`, WO-107) — since the CI-tokens
 * screen's own note (WO-364) now points here for "which branch does the official baseline follow".
 * Every other `projectSettingsSchema` field (folders, git, triage, lifecycle, ignore, GitHub linkage)
 * stays out of this form deliberately: there's no dedicated canvas for a full settings editor yet, and
 * "no inventes campos nuevos" means this WO doesn't design one from scratch.
 *
 * SDD-056/PRD-036: rebuilt on the design-system pieces (`SectionHeader`, `Panel`, `TextField`, `ReadOnlyField`,
 * `Button`) against `AjustesGeneral.dc.html`. Same fields, same request, same messages. The canvas draws the
 * project name as editable; there is no endpoint that renames a project, so it stays read-only here.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { updateProjectSettings } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { Button, Panel, ReadOnlyField, SectionHeader, TextField } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import styles from './AjustesGeneral.module.css';

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
    <div className={styles.screen}>
      <SectionHeader title="General" subtitle="Datos del proyecto y su rama oficial." />

      <Panel>
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <ReadOnlyField label="Proyecto" value={project.name} />
          <ReadOnlyField label="Identificador" value={project.slug} mono hint={`Es el que usás en los comandos: prdm link ${orgSlug}/${project.slug}.`} />
          <ReadOnlyField label="Organización" value={currentOrg.name} />
          <TextField
            label="Rama por defecto"
            value={defaultBranch}
            onChange={setDefaultBranch}
            required
            error={branchValid ? null : 'Escribí el nombre de la rama.'}
            hint="La baseline oficial de drift se calcula sobre esta rama."
          />
          <FormError message={error} />
          <div className={styles.actions}>
            {saved ? (
              <p role="status" className={styles.saved}>
                Guardado.
              </p>
            ) : null}
            <Button type="submit" variant="primary" disabled={submitting || !branchValid}>
              Guardar
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
