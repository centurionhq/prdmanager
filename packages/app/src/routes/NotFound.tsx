/**
 * The three 404s (SDD-071): the root `*`, the org splat (inside `OrgShell`'s header) and the project splat
 * (inside `ProjectShell`'s sidebar). None redirects: each says what was tried and offers a real way out.
 */
import type { ReactElement } from 'react';
import { useLocation } from 'react-router';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { NotFoundPanel } from '../components/NotFoundPanel/NotFoundPanel.js';
import { buildPrimaryNav } from '../components/shell/project-nav.js';
import { useOrgShellContext } from './OrgShell.js';
import { useProjectShellContext } from './ProjectShell.js';

const NOT_FOUND_TITLE = 'Página no encontrada';

/** The attempted path as the person typed it; a malformed `%` sequence falls back to the raw pathname. */
function useAttemptedPath(): string {
  const { pathname } = useLocation();
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function NotFound(): ReactElement {
  useDocumentTitle(NOT_FOUND_TITLE);
  const path = useAttemptedPath();

  return (
    <NotFoundPanel
      brand="prdm"
      title="Esta dirección no existe"
      body={
        <>
          La página <code>{path}</code> no existe en prdm.
        </>
      }
      action={{ to: '/', label: 'Volver al inicio' }}
    />
  );
}

export function OrgNotFound(): ReactElement {
  useDocumentTitle(NOT_FOUND_TITLE);
  const path = useAttemptedPath();
  const { orgSlug, currentOrg } = useOrgShellContext();

  return (
    <NotFoundPanel
      title={`Esta sección no existe en ${currentOrg.name}`}
      body={
        <>
          La dirección <code>{path}</code> no es una sección de la organización. Las pantallas de trabajo (Planta,
          Árbol, Documentos, Órdenes, Drift, Bandeja de entrada) viven dentro de un proyecto.
        </>
      }
      action={{ to: `/o/${orgSlug}`, label: `Ver los proyectos de ${currentOrg.name}` }}
    />
  );
}

export function ProjectNotFound(): ReactElement {
  useDocumentTitle(NOT_FOUND_TITLE);
  const path = useAttemptedPath();
  const { orgSlug, projectSlug, project } = useProjectShellContext();

  return (
    <NotFoundPanel
      title={`Esta pantalla no existe en ${project.name}`}
      body={
        <>
          La dirección <code>{path}</code> no es una pantalla del proyecto.
        </>
      }
      destinations={buildPrimaryNav(orgSlug, projectSlug)}
    />
  );
}
