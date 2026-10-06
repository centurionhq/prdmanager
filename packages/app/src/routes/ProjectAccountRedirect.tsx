/**
 * Legacy project-scoped account paths (SDD-089 §D3, WO-697): `.../p/:projectSlug/ajustes/perfil` and
 * `.../p/:projectSlug/ajustes/tokens-personales` used to render the account screens themselves. Those two
 * screens now live at the organization level (`/o/:orgSlug/ajustes/{perfil,tokens-personales}`, reachable
 * without belonging to any project), so the old paths stay as redirects — the same ADR-008 treatment
 * `/settings/tokens`, `.../graph` and `.../settings` already get — for bookmarks and for links written
 * before the move.
 *
 * It cannot be a plain relative `<Navigate to="…" replace />`: `..` walks up the *route hierarchy*, and
 * from `.../p/:projectSlug/ajustes/perfil` the parent is `/o/:orgSlug/p/:projectSlug`, never the org root.
 * The organization is already resolved and handed down through `AjustesLayout`'s outlet, so this reads it
 * from the shell context instead of guessing a default.
 */
import type { ReactElement } from 'react';
import { Navigate } from 'react-router';
import { useOrgShellContext } from './OrgShell.js';

/** The two account screens that moved to `/o/:orgSlug/ajustes/<screen>`. */
export type ProjectAccountScreen = 'perfil' | 'tokens-personales';

export function ProjectAccountRedirect({ screen }: { readonly screen: ProjectAccountScreen }): ReactElement {
  const { orgSlug } = useOrgShellContext();
  return <Navigate to={`/o/${orgSlug}/ajustes/${screen}`} replace />;
}
