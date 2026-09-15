import { useEffect } from 'react';
import { useMatches } from 'react-router';
import type { RouteHandle } from '../../router';
import { documentTitle } from './nav';

/** The deepest matched route's `handle.title`, or `undefined` on a route with no handle. */
function useRouteTitle(): string | undefined {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle as RouteHandle | undefined;
    if (handle?.title) return handle.title;
  }
  return undefined;
}

/**
 * Sets `document.title` from the current route's `handle.title` (SDD-011 "título por ruta").
 * Mounted once at the root layout so every route gets it, whether or not it renders inside
 * the app shell (e.g. /login and /proyectos).
 */
export function useDocumentTitle(): void {
  const title = useRouteTitle();

  useEffect(() => {
    document.title = documentTitle(title);
  }, [title]);
}
