/** Catch-all `*` route (SDD-013 §"Shell y router"): a plain 404 for any unmatched URL. */
import type { ReactElement } from 'react';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import formStyles from '../styles/forms.module.css';

export function NotFound(): ReactElement {
  useDocumentTitle('Página no encontrada');

  return (
    <div className={formStyles.page}>
      <div className={formStyles.card}>
        <h1 className={formStyles.title}>Página no encontrada</h1>
        <p className={formStyles.subtitle}>La dirección a la que intentaste llegar no existe.</p>
      </div>
    </div>
  );
}
