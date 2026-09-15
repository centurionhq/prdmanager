import type { ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { EmptyState } from '../../components';

/** Shared placeholder for settings sections that have no screen yet (WO-304). */
export function AjustesPlaceholderPage(): ReactElement {
  const navigate = useNavigate();

  return (
    <EmptyState
      title="Esta sección todavía no está diseñada."
      action={{ label: 'Volver a Miembros', onClick: () => navigate('/ajustes/miembros') }}
    />
  );
}
