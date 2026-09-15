/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/tokens` (SDD-006 §Permisos "tokens de CI", `manage_ci_tokens`,
 * SDD-013 §"Shell y router"): mounts `CiTokensSection` directly — it already fetches its own tokens —
 * gated by `can(subject, 'manage_ci_tokens')`, `subject` coming from `ProjectShell`'s own context.
 */
import type { ReactElement } from 'react';
import { can } from '@prdm/contracts';
import { CiTokensSection } from './CiTokensSection.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import formStyles from '../styles/forms.module.css';

export function AjustesTokens(): ReactElement {
  const { orgSlug, projectSlug, subject } = useProjectShellContext();
  useDocumentTitle('Ajustes · tokens de CI');

  if (!can(subject, 'manage_ci_tokens')) {
    return <p className={formStyles.subtitle}>No tenés permiso para gestionar tokens de CI en este proyecto.</p>;
  }

  return <CiTokensSection orgSlug={orgSlug} projectSlug={projectSlug} />;
}
