/**
 * `/settings/tokens` (legacy, pre-ADR-008): the personal-tokens screen moved to
 * `/o/:orgSlug/p/:projectSlug/ajustes/tokens-personales` (SDD-013 §"Shell y router"). There is no
 * "active project" concept in this SPA session yet, so this always falls back to the caller's first
 * visible organization and first visible project in it — the fallback ADR-008 documents for "no hay uno
 * activo en contexto".
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Navigate } from 'react-router';
import { LoadingState } from '@prdm/ui';
import { getProjectsOverview, listOrganizations } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { FormNotice } from '../components/FormNotice.js';
import formStyles from '../styles/forms.module.css';

type Status = { kind: 'loading' } | { kind: 'redirect'; to: string } | { kind: 'no-project' } | { kind: 'error'; message: string };

export function SettingsTokensRedirect(): ReactElement {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        const organizations = await listOrganizations();
        const firstOrg = organizations[0];
        if (!firstOrg) {
          if (!cancelled) setStatus({ kind: 'no-project' });
          return;
        }
        const projects = await getProjectsOverview(firstOrg.slug);
        const firstProject = projects[0];
        if (!firstProject) {
          if (!cancelled) setStatus({ kind: 'no-project' });
          return;
        }
        if (!cancelled) {
          setStatus({ kind: 'redirect', to: `/o/${firstOrg.slug}/p/${firstProject.slug}/ajustes/tokens-personales` });
        }
      } catch (err) {
        if (!cancelled) setStatus({ kind: 'error', message: errorMessage(err) });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === 'loading') return <LoadingState label="Redirigiendo…" />;
  if (status.kind === 'redirect') return <Navigate to={status.to} replace />;

  if (status.kind === 'no-project') {
    return <FormNotice title="Todavía no tenés un proyecto" subtitle="Pedile a un administrador que te invite a un proyecto para gestionar tus tokens." />;
  }

  return (
    <div className={formStyles.page}>
      <div className={formStyles.card}>
        <FormError message={status.message} />
      </div>
    </div>
  );
}
