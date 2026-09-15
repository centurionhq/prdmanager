/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/perfil` (SDD-013 §"Shell y router"): the new home for signing out,
 * now that the persistent `AppShell` sidebar no longer has a "Cerrar sesión" button of its own (the
 * mock's own canvas keeps the sidebar to navigation + the person's own name/role, no actions).
 */
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/index.js';
import { signOut } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';

export function AjustesPerfil(): ReactElement {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('Ajustes · perfil');

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
      {error && <FormError message={error} />}
      <p>La edición del perfil (nombre, contraseña, verificación en dos pasos) llega en un próximo work order.</p>
      <Button type="button" variant="destructive" onClick={() => void handleSignOut()}>
        Cerrar sesión
      </Button>
    </div>
  );
}
