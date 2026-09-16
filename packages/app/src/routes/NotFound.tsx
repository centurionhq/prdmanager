/** Catch-all `*` route (SDD-013 §"Shell y router"): a plain 404 for any unmatched URL. */
import type { ReactElement } from 'react';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { FormNotice } from '../components/FormNotice.js';

export function NotFound(): ReactElement {
  useDocumentTitle('Página no encontrada');

  return <FormNotice title="Página no encontrada" subtitle="La dirección a la que intentaste llegar no existe." />;
}
