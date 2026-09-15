/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/general` (SDD-013 §"Shell y router"): read-only project identity
 * for now — editing `.prdm.yaml`-backed settings from the UI is a later work order.
 */
import type { ReactElement } from 'react';
import { IdTag } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import formStyles from '../styles/forms.module.css';

export function AjustesGeneral(): ReactElement {
  const { project, currentOrg } = useProjectShellContext();
  useDocumentTitle('Ajustes · general');

  return (
    <div>
      <h2 className={formStyles.title}>{project.name}</h2>
      <p className={formStyles.subtitle}>
        <IdTag id={project.slug} /> · organización {currentOrg.name}
      </p>
      <p>La edición de la configuración general del proyecto (carpetas, ciclo de vida, ignorados) llega en un próximo work order.</p>
    </div>
  );
}
