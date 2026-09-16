/**
 * `/` (SDD-006 §Dashboard shell, WO-117): no dashboard content of its own — sends a signed-out visitor to
 * `/login`, and a signed-in one straight to their first organization's project dashboard (`/o/:orgSlug`).
 * A signed-in user who belongs to no organization yet (e.g. a freshly-bootstrapped superadmin, who SDD-006
 * says never gets implicit membership) sees a plain message instead of a dead-end redirect loop.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { getSession, listOrganizations } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { FormNotice } from '../components/FormNotice.js';
import styles from '../styles/forms.module.css';

type Status = { kind: 'loading' } | { kind: 'no-organizations' } | { kind: 'error'; message: string };

export function RootRedirect(): ReactElement {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        const session = await getSession();
        if (!session) {
          if (!cancelled) navigate('/login', { replace: true });
          return;
        }
        const organizations = await listOrganizations();
        if (cancelled) return;
        const first = organizations[0];
        if (first) {
          navigate(`/o/${first.slug}`, { replace: true });
          return;
        }
        setStatus({ kind: 'no-organizations' });
      } catch (err) {
        if (!cancelled) setStatus({ kind: 'error', message: errorMessage(err) });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (status.kind === 'loading') {
    return (
      <div className={styles.page}>
        <p role="status">Cargando…</p>
      </div>
    );
  }

  if (status.kind === 'no-organizations') {
    return (
      <FormNotice
        title="Todavía no pertenecés a ninguna organización"
        subtitle="Pedile a un administrador que te invite, o esperá el enlace de invitación por email."
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <FormError message={status.message} />
      </div>
    </div>
  );
}
