/**
 * `/o/:orgSlug` index route (SDD-006 §Dashboard shell, WO-117): the selected organization's projects,
 * plus a "New project" action gated to org owners/admins (SDD-006 §Permisos — creating a project is an
 * org-wide action, same gate `packages/server/src/api/projects.ts` enforces server-side).
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router';
import { PROJECT_SLUG_PATTERN, projectNameSchema, projectSlugSchema, type ProjectSummary } from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { createProject, listProjects } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { isOrgAdmin } from '../auth/org-role.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useOrgShellContext } from './OrgShell.js';
import formStyles from '../styles/forms.module.css';
import styles from '../styles/dashboard.module.css';

function NewProjectForm({ orgSlug, onCreated }: { orgSlug: string; onCreated: (project: ProjectSummary) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugValid = projectSlugSchema.safeParse(slug).success;
  const nameValid = projectNameSchema.safeParse(name).success;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!slugValid || !nameValid) return;

    setSubmitting(true);
    try {
      const project = await createProject(orgSlug, { slug, name });
      onCreated(project);
      setOpen(false);
      setSlug('');
      setName('');
      setTouched(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={formStyles.primaryButton} onClick={() => setOpen(true)}>
        Nuevo proyecto
      </button>
    );
  }

  return (
    <form className={formStyles.card} onSubmit={handleSubmit} noValidate>
      <h2 className={formStyles.title}>Nuevo proyecto</h2>
      <div className={formStyles.field}>
        <label htmlFor="project-name">Nombre</label>
        <input
          id="project-name"
          type="text"
          required
          value={name}
          data-touched={touched}
          aria-describedby={touched && !nameValid ? 'project-name-hint' : undefined}
          aria-invalid={touched && !nameValid}
          onChange={(e) => setName(e.target.value)}
        />
        {touched && !nameValid && (
          <span id="project-name-hint" className={formStyles.hint}>
            Ingresá un nombre (máx. 100 caracteres).
          </span>
        )}
      </div>
      <div className={formStyles.field}>
        <label htmlFor="project-slug">Slug</label>
        <input
          id="project-slug"
          type="text"
          required
          value={slug}
          data-touched={touched}
          aria-describedby={touched && !slugValid ? 'project-slug-hint' : undefined}
          aria-invalid={touched && !slugValid}
          onChange={(e) => setSlug(e.target.value)}
        />
        {touched && !slugValid && (
          <span id="project-slug-hint" className={formStyles.hint}>
            Minúsculas, números y guiones simples (coincide con {PROJECT_SLUG_PATTERN.source}).
          </span>
        )}
      </div>
      <FormError message={error} />
      <div className={formStyles.actions}>
        <button type="button" className={formStyles.secondaryButton} onClick={() => setOpen(false)}>
          Cancelar
        </button>
        <button type="submit" className={formStyles.primaryButton} disabled={submitting}>
          Crear
        </button>
      </div>
    </form>
  );
}

export function ProjectsDashboard(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(`Proyectos de ${currentOrg.name}`);

  useEffect(() => {
    let cancelled = false;
    setProjects(null);
    listProjects(orgSlug)
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  return (
    <div>
      <div className={styles.contentHeader}>
        <h1 className={formStyles.title}>Proyectos</h1>
        {isOrgAdmin(currentOrg.role) && (
          <NewProjectForm orgSlug={orgSlug} onCreated={(project) => setProjects((prev) => [...(prev ?? []), project])} />
        )}
      </div>
      <FormError message={error} />
      {!projects && !error && <LoadingState label="Cargando proyectos…" />}
      {projects && projects.length === 0 && <p className={formStyles.hint}>Todavía no hay proyectos en esta organización.</p>}
      {projects && projects.length > 0 && (
        <div className={styles.grid}>
          {projects.map((project) => (
            <Link key={project.id} to={`/o/${orgSlug}/p/${project.slug}`} className={styles.projectCard}>
              <p className={styles.projectName}>{project.name}</p>
              <p className={styles.projectSlug}>{project.slug}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
