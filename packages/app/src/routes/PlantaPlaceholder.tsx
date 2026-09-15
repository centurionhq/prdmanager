/**
 * `/o/:orgSlug/p/:projectSlug` index (Planta): the line board wired to real data is WO-354's job — this
 * is a placeholder so the route exists and the shell renders around it (SDD-013 §"Shell y router").
 */
import type { ReactElement } from 'react';
import { EmptyState, PageHeader } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';

export function PlantaPlaceholder(): ReactElement {
  useDocumentTitle('Planta');

  return (
    <div>
      <PageHeader title="Planta" subtitle="El tablero de línea de producción se conecta a la API real en un próximo work order." />
      <EmptyState title="Todavía no hay tablero de Planta" />
    </div>
  );
}
