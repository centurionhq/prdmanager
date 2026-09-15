/**
 * `/o/:orgSlug/p/:projectSlug/ordenes` (SDD-013 §"Shell y router"): the work-order board wired to real
 * data is a later work order — placeholder so the route exists and the shell renders around it.
 */
import type { ReactElement } from 'react';
import { EmptyState, PageHeader } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';

export function OrdenesPlaceholder(): ReactElement {
  useDocumentTitle('Órdenes de trabajo');

  return (
    <div>
      <PageHeader title="Órdenes de trabajo" subtitle="Esta pantalla se conecta a la API real en un próximo work order." />
      <EmptyState title="Todavía no hay órdenes de trabajo para mostrar" />
    </div>
  );
}
