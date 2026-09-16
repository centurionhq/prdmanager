/**
 * `/admin` (SDD-006 §Autenticación, WO-120): superadmin-only organization list/create. Requires a
 * TOTP-verified session (WO-102 `requireSuperadminSession`, exercised by `Login.tsx`'s own TOTP step) —
 * every call here 401/403s identically to any other `/api/app/admin/*` route for anyone else, this
 * screen adds no client-side gate of its own beyond surfacing that as a plain error (SDD-006:
 * superadmins never get implicit org membership, so there's no session state here to redirect on —
 * `RootRedirect`'s own "no organizations" screen already covers a fresh superadmin's `/` visit).
 *
 * The list itself (`GET /api/app/admin/organizations`) is a small, documented WO-120 server addition —
 * see the WO's own report and `packages/server/src/api/admin-organizations.ts`'s doc comment — since the
 * SDD only specified the `POST` create endpoint and a panel with no way to see what it already created
 * would be a real usability gap.
 *
 * WO-365 canvas review (`AdminOrganizations.dc.html`) additionally shows "Proyectos"/"Miembros"/"Owner"/
 * "Creada" columns and a modal for "Crear organización" instead of an inline form. The modal is real
 * (WO-348's `Modal`); those extra columns are not — `AdminOrganizationSummary` only ever carries
 * `id`/`slug`/`name` (deliberately: "superadmins have no implicit access to [org] content", same doc
 * comment as above), and every endpoint that *could* answer "how many members/projects" requires being a
 * member of that org, which a superadmin creating it on someone else's behalf never is. Fabricating those
 * columns from data this screen can't actually fetch would be worse than the canvas's own gap.
 */
import { PROJECT_SLUG_PATTERN, projectSlugSchema } from '@prdm/contracts';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { LoadingState } from '@prdm/ui';
import { createOrganizationAsSuperadmin, listAllOrganizationsAsSuperadmin, type AdminOrganizationSummary } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { Modal } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import dashboardStyles from '../styles/dashboard.module.css';
import styles from '../styles/forms.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CREATE_ORG_FORM_ID = 'admin-create-org-form';

function CreateOrganizationForm({
  onCreated,
  onSubmittingChange,
}: {
  onCreated: (org: AdminOrganizationSummary, ownerEmail: string) => void;
  onSubmittingChange: (submitting: boolean) => void;
}): ReactElement {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameValid = name.trim().length > 0;
  // The admin org-creation endpoint's own slug pattern (`/^[a-z0-9]+(-[a-z0-9]+)*$/`, see
  // `packages/server/src/api/admin-organizations.ts`) is identical to @prdm/contracts's
  // PROJECT_SLUG_PATTERN — reused here rather than re-declared.
  const slugValid = projectSlugSchema.safeParse(slug).success;
  const emailValid = EMAIL_PATTERN.test(ownerEmail);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!nameValid || !slugValid || !emailValid) return;

    onSubmittingChange(true);
    try {
      const result = await createOrganizationAsSuperadmin({ name: name.trim(), slug, ownerEmail });
      onCreated({ id: result.organizationId, slug: result.slug, name: name.trim() }, ownerEmail);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      onSubmittingChange(false);
    }
  }

  return (
    <form id={CREATE_ORG_FORM_ID} className={styles.field} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="admin-org-name">Nombre</label>
        <input
          id="admin-org-name"
          type="text"
          required
          value={name}
          data-touched={touched}
          aria-describedby={touched && !nameValid ? 'admin-org-name-hint' : undefined}
          aria-invalid={touched && !nameValid}
          onChange={(e) => setName(e.target.value)}
        />
        {touched && !nameValid && (
          <span id="admin-org-name-hint" className={styles.hint}>
            Ingresá un nombre.
          </span>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor="admin-org-slug">Slug</label>
        <input
          id="admin-org-slug"
          type="text"
          required
          value={slug}
          data-touched={touched}
          aria-describedby={touched && !slugValid ? 'admin-org-slug-hint' : undefined}
          aria-invalid={touched && !slugValid}
          onChange={(e) => setSlug(e.target.value)}
        />
        {touched && !slugValid && (
          <span id="admin-org-slug-hint" className={styles.hint}>
            Minúsculas, números y guiones simples (coincide con {PROJECT_SLUG_PATTERN.source}).
          </span>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor="admin-org-owner-email">Email del owner</label>
        <input
          id="admin-org-owner-email"
          type="email"
          required
          value={ownerEmail}
          data-touched={touched}
          aria-describedby={touched && !emailValid ? 'admin-org-owner-email-hint' : undefined}
          aria-invalid={touched && !emailValid}
          onChange={(e) => setOwnerEmail(e.target.value)}
        />
        {touched && !emailValid && (
          <span id="admin-org-owner-email-hint" className={styles.hint}>
            Ingresá un email válido.
          </span>
        )}
      </div>
      <p className={styles.hint}>El owner recibe una invitación por email. El contenido de esta organización se procesa con DeepSeek.</p>
      <FormError message={error} />
    </form>
  );
}

export function AdminOrganizations(): ReactElement {
  const [organizations, setOrganizations] = useState<AdminOrganizationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useDocumentTitle('Organizaciones');

  useEffect(() => {
    listAllOrganizationsAsSuperadmin()
      .then(setOrganizations)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  function handleCreated(org: AdminOrganizationSummary, ownerEmail: string): void {
    setOrganizations((prev) => [...(prev ?? []), org]);
    setCreateOpen(false);
    // SDD-006 "Dashboard (shell)": "Al crear una organización se informa que el contenido se procesa
    // con DeepSeek" — the create response carries no such flag today, so this is a static disclosure
    // rather than a server-supplied notice (checked first; see the WO-120 report).
    setNotice(`Se invitó a ${ownerEmail} como owner. El contenido de esta organización se procesará automáticamente con DeepSeek.`);
  }

  return (
    <div className={dashboardStyles.content}>
      <div className={styles.actions}>
        <h1 className={styles.title}>Organizaciones</h1>
        <button type="button" className={styles.primaryButton} onClick={() => setCreateOpen(true)}>
          Crear organización
        </button>
      </div>
      <FormError message={error} />
      {notice && <p className={styles.success}>{notice}</p>}
      {!organizations && !error && <LoadingState label="Cargando organizaciones…" />}
      {organizations && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Slug</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((org) => (
                <tr key={org.id}>
                  <td>{org.name}</td>
                  <td>{org.slug}</td>
                </tr>
              ))}
              {organizations.length === 0 && (
                <tr>
                  <td colSpan={2}>Todavía no se creó ninguna organización.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        title="Crear organización"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className={styles.secondaryButton} onClick={() => setCreateOpen(false)}>
              Cancelar
            </button>
            <button type="submit" form={CREATE_ORG_FORM_ID} className={styles.primaryButton} disabled={submitting}>
              Crear e invitar
            </button>
          </>
        }
      >
        <CreateOrganizationForm onCreated={handleCreated} onSubmittingChange={setSubmitting} />
      </Modal>
    </div>
  );
}
