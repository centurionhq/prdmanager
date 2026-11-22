/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/general` (SDD-013 §"Shell y router", SDD-090 WO-702): the project's
 * configuration in the seven groups `AjustesGeneral.dc.html` draws (WO-701). Identity (group 1) and what another
 * process decides (group 7: grandfathered documents, GitHub linkage, hash algorithm) are read-only; the branch,
 * the folders per document kind, the ignore patterns, the git rules and the triage thresholds are edited here.
 *
 * The form's rules live in `lib/project-settings-form.ts` and mirror `projectSettingsSchema`. The PATCH is a total
 * replacement (`updateProjectSettings`, SDD-006 / WO-107), so the request always carries the COMPLETE settings
 * object -- including the fields this screen only shows. Validation runs on submit, not on every key, so a project
 * without folders never opens the screen full of red. The project name is read-only: no endpoint renames a project.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { updateProjectSettings } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { Button, CheckboxField, Panel, ReadOnlyField, SectionHeader, SettingsSection, TextField } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import {
  FOLDER_FIELDS,
  toForm,
  toSettings,
  validateForm,
  type ProjectSettingsForm,
} from '../lib/project-settings-form.js';
import { useProjectShellContext } from './ProjectShell.js';
import styles from './AjustesGeneral.module.css';

const NOT_LINKED = 'Sin vincular';

export function AjustesGeneral(): ReactElement {
  const { orgSlug, projectSlug, project, currentOrg } = useProjectShellContext();
  const [form, setForm] = useState<ProjectSettingsForm>(() => toForm(project.settings));
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useDocumentTitle('Ajustes · general');

  const errors = attempted ? validateForm(form) : {};

  function patch(change: Partial<ProjectSettingsForm>): void {
    setForm((current) => ({ ...current, ...change }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setAttempted(true);
    if (Object.keys(validateForm(form)).length > 0) return;

    setSubmitting(true);
    try {
      const updated = await updateProjectSettings(orgSlug, projectSlug, { settings: toSettings(form) });
      setForm(toForm(updated.settings));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const grandfathered = form.grandfathered.map((doc) => doc.id).join(', ');

  return (
    <div className={styles.screen}>
      <SectionHeader title="General" subtitle="Datos del proyecto y su rama oficial." />

      <Panel>
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <SettingsSection title="Identidad del proyecto" description="De dónde es el proyecto. Se ve acá; no se edita.">
            <ReadOnlyField label="Proyecto" value={project.name} />
            <ReadOnlyField label="Organización" value={currentOrg.name} />
            <ReadOnlyField label="Identificador" value={project.slug} mono hint={`Es el que usás en los comandos: prdm link ${orgSlug}/${project.slug}.`} />
          </SettingsSection>

          <SettingsSection title="Rama oficial" description="Cuál es la rama oficial del proyecto.">
            <TextField
              label="Rama por defecto"
              value={form.defaultBranch}
              onChange={(defaultBranch) => patch({ defaultBranch })}
              required
              error={errors.defaultBranch}
              hint="La baseline oficial de drift se calcula sobre esta rama."
            />
          </SettingsSection>

          <SettingsSection
            title="Carpetas por tipo de documento"
            description="La carpeta de cada tipo dentro del proyecto. Vacío = se usa la carpeta por defecto del proyecto."
          >
            <div className={styles.grid}>
              {FOLDER_FIELDS.map(({ kind, label }) => (
                <TextField
                  key={kind}
                  label={label}
                  value={form.folders[kind]}
                  onChange={(value) => patch({ folders: { ...form.folders, [kind]: value } })}
                  mono
                  error={errors[`folders.${kind}`]}
                />
              ))}
            </div>
          </SettingsSection>

          <SettingsSection title="Archivos ignorados" description="Lo que el escáner saltea al buscar documentos.">
            <TextField
              label="Patrones ignorados"
              value={form.ignore}
              onChange={(ignore) => patch({ ignore })}
              multiline
              rows={4}
              mono
              hint="Un patrón por línea. Se comparan como glob contra la ruta de cada archivo."
            />
          </SettingsSection>

          <SettingsSection title="Reglas de git" description="Qué se exige a los commits que tocan el proyecto.">
            <TextField
              label="Commits a mirar"
              value={form.git.maxCommits}
              onChange={(maxCommits) => patch({ git: { ...form.git, maxCommits } })}
              inputMode="numeric"
              error={errors['git.maxCommits']}
              hint="Cuántos commits hacia atrás mira el escaneo."
            />
            <TextField
              label="Exigir el trailer desde"
              value={form.git.enforceRefsSince}
              onChange={(enforceRefsSince) => patch({ git: { ...form.git, enforceRefsSince } })}
              mono
              error={errors['git.enforceRefsSince']}
              hint="Un sha de 7 a 40 caracteres hexadecimales. Vacío = se exige desde siempre; con un sha, los commits anteriores quedan exentos."
            />
            <CheckboxField
              label="Exigir el trailer «Refs:» en cada commit que toca una ruta gobernada."
              checked={form.git.enforceRefs}
              onChange={(enforceRefs) => patch({ git: { ...form.git, enforceRefs } })}
            />
          </SettingsSection>

          <SettingsSection title="Triaje automático" description="Cuándo un feedback se enlaza solo a una feature.">
            <div className={styles.grid}>
              <TextField
                label="Puntaje mínimo del candidato"
                value={form.triage.autoLinkMinScore}
                onChange={(autoLinkMinScore) => patch({ triage: { ...form.triage, autoLinkMinScore } })}
                inputMode="decimal"
                error={errors['triage.autoLinkMinScore']}
                hint="El mejor candidato tiene que llegar a este puntaje para enlazarse solo. Más alto = menos enlaces automáticos."
              />
              <TextField
                label="Ventaja sobre el segundo"
                value={form.triage.autoLinkMargin}
                onChange={(autoLinkMargin) => patch({ triage: { ...form.triage, autoLinkMargin } })}
                inputMode="decimal"
                error={errors['triage.autoLinkMargin']}
                hint="Cuántas veces tiene que superar el primero al segundo. Más alto = sólo enlaza si hay un ganador claro."
              />
              <TextField
                label="Candidatas a comparar"
                value={form.triage.maxCandidates}
                onChange={(maxCandidates) => patch({ triage: { ...form.triage, maxCandidates } })}
                inputMode="numeric"
                error={errors['triage.maxCandidates']}
                hint="Cuántas features se buscan por cada texto. Más alto = más opciones para elegir a mano."
              />
              <TextField
                label="Términos en común"
                value={form.triage.minMatchedTerms}
                onChange={(minMatchedTerms) => patch({ triage: { ...form.triage, minMatchedTerms } })}
                inputMode="numeric"
                error={errors['triage.minMatchedTerms']}
                hint="Cuántos términos del texto tiene que compartir el candidato para confirmar el enlace. Más alto = más exigente."
              />
            </div>
          </SettingsSection>

          <SettingsSection
            title="Lo que decide otro proceso"
            description="Se ve acá para entender el proyecto; no se edita desde el dashboard."
          >
            <ReadOnlyField
              label="Documentos exentos del baseline"
              value={grandfathered === '' ? 'Ninguno' : grandfathered}
              mono={grandfathered !== ''}
              note="No se edita acá"
              hint="Lo escribe el re-baseline de drift cuando exime un documento del baseline oficial."
            />
            <ReadOnlyField
              label="Repositorio de GitHub"
              value={form.githubRepository === '' ? NOT_LINKED : form.githubRepository}
              mono
              note="No se edita acá"
              hint="Lo escribe la vinculación con GitHub (la app de GitHub), no el dashboard."
            />
            <div className={styles.grid}>
              <ReadOnlyField
                label="Id del repositorio"
                value={form.githubRepositoryId === '' ? NOT_LINKED : form.githubRepositoryId}
                mono
                hint="Lo escribe la vinculación con GitHub."
              />
              <ReadOnlyField
                label="Id del dueño en GitHub"
                value={form.githubOwnerId === '' ? NOT_LINKED : form.githubOwnerId}
                mono
                hint="Lo escribe la vinculación con GitHub."
              />
            </div>
            <ReadOnlyField
              label="Versión del algoritmo de hash"
              value={form.hashAlgoVersion}
              mono
              hint="Lo fija el pipeline al calcular el hash de cada documento."
            />
          </SettingsSection>

          <FormError message={error} />
          <div className={styles.actions}>
            {saved ? (
              <p role="status" className={styles.saved}>
                Guardado.
              </p>
            ) : null}
            <Button type="submit" variant="primary" disabled={submitting}>
              Guardar
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
