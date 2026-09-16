/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/perfil` (SDD-013 §"Shell y router"): the new home for signing out,
 * now that the persistent `AppShell` sidebar no longer has a "Cerrar sesión" button of its own (the
 * mock's own canvas keeps the sidebar to navigation + the person's own name/role, no actions).
 *
 * WO-365: the canvas (`AjustesPerfil.dc.html`) also shows an editable name and a read-only handle.
 * Name stays read-only here too — `packages/server/src/auth/allowlist.ts` explicitly excludes
 * better-auth's own `/update-user` (grouped there with `/change-email`/`/delete-user`, none of them
 * reachable over HTTP), so there is no real endpoint this screen could call; inventing one is outside
 * this WO's `packages/app/**`-only scope. The handle (`user_profile.handle`, the `dev:<handle>` actor
 * identity used by commits/work orders — see `packages/server/src/api/project-work-orders.ts`) is
 * dropped for the same reason: no `/api/app/*` route exposes it to the dashboard yet.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import type { AuthUser } from '../api/auth.js';
import { Button } from '../components/index.js';
import { getSession, signOut } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import styles from '../styles/forms.module.css';

export function AjustesPerfil(): ReactElement {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('Ajustes · perfil');

  useEffect(() => {
    getSession()
      .then((session) => setUser(session?.user ?? null))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <h2 className={styles.title}>Perfil</h2>
      <p className={styles.subtitle}>Tu identidad en Centurion Factory.</p>
      {error && <FormError message={error} />}

      {user && (
        <>
          <div className={styles.field}>
            <label htmlFor="profile-name">Nombre</label>
            <input id="profile-name" type="text" value={user.name} disabled />
          </div>
          <div className={styles.field}>
            <label htmlFor="profile-email">Email</label>
            <div id="profile-email" className={styles.notice}>
              {user.email} <span>No se puede cambiar</span>
            </div>
          </div>
        </>
      )}

      <Button type="button" variant="destructive" onClick={() => void handleSignOut()}>
        Cerrar sesión
      </Button>
    </div>
  );
}
