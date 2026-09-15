/**
 * `/o/:orgSlug/p/:projectSlug/entrada` (SDD-013 §"Shell y router"): the feedback triage inbox wired to
 * real data is a later work order — placeholder so the route exists and the shell renders around it.
 */
import type { ReactElement } from 'react';
import { EmptyState, PageHeader } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';

export function EntradaPlaceholder(): ReactElement {
  useDocumentTitle('Bandeja de entrada');

  return (
    <div>
      <PageHeader title="Bandeja de entrada" subtitle="Esta pantalla se conecta a la API real en un próximo work order." />
      <EmptyState title="Todavía no hay feedback para triar" />
    </div>
  );
}
