/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/perfil` (SDD-013 §"Shell y router"): the new home for signing out,
 * now that the persistent `AppShell` sidebar no longer has a "Cerrar sesión" button of its own (the
 * mock's own canvas keeps the sidebar to navigation + the person's own name/role, no actions).
 *
 * WO-365: the canvas (`AjustesPerfil.dc.html`) also shows an editable name and a read-only handle.
 * Name stays read-only here too — `packages/server/src/auth/allowlist.ts` explicitly excludes
 * better-auth's own `/update-user` (grouped there with `/change-email`/`/delete-user`, none of them
 * reachable over HTTP), so there is no real endpoint this screen could call; inventing one is outside
 * this WO's `packages/app/**`-only scope.
 *
 * WO-432 (PRD-009, discovered while archiving PRD-008's own orphaned work orders): the handle
 * (`user_profile.handle`, the `dev:<handle>` actor identity `claim_work_order`/`complete_work_order`/
 * `archive_work_order` require of every human token — see `packages/server/src/api/project-work-orders.ts`)
 * is now set-once here via `POST /api/app/profile/handle`. It stays immutable once set (enforced in the
 * database, `packages/db/src/schema/user-profile.ts`), so once `getProfile` reports one, this screen only
 * ever displays it — never a second form to change it.
 *
 * SDD-056/PRD-036: rebuilt on the design-system pieces against `AjustesPerfil.dc.html`. Same behaviour. Two
 * things the canvas draws are left out because nothing backs them: an editable name (see WO-365 above) and
 * "Verificación en dos pasos", which has no endpoint; PRD-036 adds no functionality to Ajustes.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import type { AuthUser } from '../api/auth.js';
import { Button, Panel, ReadOnlyField, SectionHeader, TextField } from '../components/index.js';
import { getProfile, getSession, setProfileHandle, signOut } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import styles from './AjustesPerfil.module.css';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function AjustesPerfil(): ReactElement {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  const [handleInput, setHandleInput] = useState('');
  const [submittingHandle, setSubmittingHandle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handleError, setHandleError] = useState<string | null>(null);
  useDocumentTitle('Ajustes · perfil');

  useEffect(() => {
    getSession()
      .then((session) => setUser(session?.user ?? null))
      .catch((err: unknown) => setError(errorMessage(err)));
    getProfile()
      .then((profile) => setHandle(profile.handle))
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

  async function handleSetHandle(event: FormEvent): Promise<void> {
    event.preventDefault();
    setHandleError(null);
    const trimmed = handleInput.trim();
    if (!trimmed) return;

    setSubmittingHandle(true);
    try {
      const result = await setProfileHandle({ handle: trimmed });
      setHandle(result.handle);
    } catch (err) {
      setHandleError(errorMessage(err));
    } finally {
      setSubmittingHandle(false);
    }
  }

  return (
    <div className={styles.screen}>
      <SectionHeader title="Perfil" subtitle="Tu identidad en Centurion Factory." />
      <FormError message={error} />

      {user ? (
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {initialsOf(user.name)}
          </span>
          <div className={styles.identityText}>
            <span className={styles.identityName}>{user.name}</span>
            {handle ? <span className={`id ${styles.identityHandle}`}>dev:{handle}</span> : null}
          </div>
        </div>
      ) : null}

      <Panel>
        {user ? (
          <>
            <ReadOnlyField label="Nombre" value={user.name} />
            <ReadOnlyField label="Email" value={user.email} note="No se puede cambiar" />
          </>
        ) : null}

        {handle !== undefined ? (
          handle !== null ? (
            <ReadOnlyField label="Handle" value={handle} mono note={`Fijo: identifica tus commits como dev:${handle}`} />
          ) : (
            <form className={styles.form} onSubmit={(e) => void handleSetHandle(e)} noValidate>
              <TextField
                label="Handle"
                value={handleInput}
                onChange={setHandleInput}
                placeholder="tu-handle"
                error={handleError}
                hint="Se usa como tu identidad dev:<handle> al reclamar o archivar Work Orders. Se puede setear una sola vez."
              />
              <div className={styles.actions}>
                <Button type="submit" variant="primary" disabled={submittingHandle || !handleInput.trim()}>
                  Guardar handle
                </Button>
              </div>
            </form>
          )
        ) : null}
      </Panel>

      <div>
        <Button type="button" variant="destructive" onClick={() => void handleSignOut()}>
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
