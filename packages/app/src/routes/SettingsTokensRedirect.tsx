/**
 * `/settings/tokens` (legacy, pre-ADR-008): the personal-tokens screen moved to
 * `/o/:orgSlug/ajustes/tokens-personales` (SDD-089 §D5, WO-697). The account screen no longer lives inside
 * a project, so this redirect only needs the caller's first visible organization — it never asks for (nor
 * falls back to) a project, and a caller with no organization at all gets the notice below instead of a
 * project invitation. That is the fallback ADR-008 documents for "no hay uno activo en contexto".
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Navigate } from 'react-router';
import { LoadingState } from '@prdm/ui';
import { listOrganizations } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { FormNotice } from '../components/FormNotice.js';
import formStyles from '../styles/forms.module.css';

type Status = { kind: 'loading' } | { kind: 'redirect'; to: string } | { kind: 'no-organization' } | { kind: 'error'; message: string };

export function SettingsTokensRedirect(): ReactElement {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    listOrganizations()
      .then((organizations) => {
        const firstOrg = organizations[0];
        if (!firstOrg) {
          if (!cancelled) setStatus({ kind: 'no-organization' });
          return;
        }
        if (!cancelled) setStatus({ kind: 'redirect', to: `/o/${firstOrg.slug}/ajustes/tokens-personales` });
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatus({ kind: 'error', message: errorMessage(err) });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === 'loading') return <LoadingState label="Redirigiendo…" />;
  if (status.kind === 'redirect') return <Navigate to={status.to} replace />;

  if (status.kind === 'no-organization') {
    return (
      <FormNotice
        title="Todavía no pertenecés a ninguna organización"
        subtitle="Pedile a quien administra que te sume a una organización para gestionar tus tokens personales."
      />
    );
  }

  return (
    <div className={formStyles.page}>
      <div className={formStyles.card}>
        <FormError message={status.message} />
      </div>
    </div>
  );
}
