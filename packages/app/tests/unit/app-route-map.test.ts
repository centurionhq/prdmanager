// Ata el mapa de rutas de `@prdm/contracts` (`matchesAppRoute`, que el server usa para responder 404 reales)
// al árbol `routes` de `src/router.tsx`. Nacido de SDD-071 / FB-110: si alguien agrega una ruta al router
// y no al mapa, este test falla.
import { describe, expect, it, vi } from 'vitest';

// `router.tsx` llama a `createBrowserRouter(routes)` en el scope del módulo y esta suite corre en el
// proyecto unit-node (sin DOM): se stubea el router de browser antes de cargar el módulo bajo prueba.
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  createBrowserRouter: () => ({}),
}));

import { matchesAppRoute } from '@prdm/contracts';
import type { RouteObject } from 'react-router';

// El tsconfig raíz de tests no tiene `--jsx`: el path en variable evita que tsc siga el import a `router.tsx`.
const ROUTER_MODULE = '../../src/router.js';
const { routes } = (await import(/* @vite-ignore */ ROUTER_MODULE)) as { routes: RouteObject[] };

const PARAM_VALUES: Record<string, string> = {
  orgSlug: 'acme',
  projectSlug: 'web',
  id: 'x1',
  docId: 'DOC-1',
};

/** Expande un patrón del router a paths de ejemplo; `:param?` genera la variante con y sin segmento. */
function expandPattern(pattern: string): string[] {
  let variants = [''];
  for (const segment of pattern.split('/').filter(Boolean)) {
    const match = /^:(\w+)(\?)?$/.exec(segment);
    const value = match ? (PARAM_VALUES[match[1]!] ?? 'x1') : segment;
    const withSegment = variants.map((v) => `${v}/${value}`);
    variants = match?.[2] ? [...variants, ...withSegment] : withSegment;
  }
  return variants.map((v) => v || '/');
}

function collectPaths(list: RouteObject[], parent: string): string[] {
  return list.flatMap((route) => {
    if (route.path === '*') return [];
    const own = route.index || route.path === undefined ? parent : route.path;
    const full = own.startsWith('/') ? own : `${parent.replace(/\/$/, '')}/${own}`;
    const here = route.index || route.path !== undefined ? expandPattern(full) : [];
    return [...here, ...collectPaths(route.children ?? [], full)];
  });
}

describe('matchesAppRoute', () => {
  it('matches every real route of the router tree', () => {
    const paths = [...new Set(collectPaths(routes, ''))];

    expect(paths.length).toBeGreaterThanOrEqual(20);
    const unmapped = paths.filter((p) => !matchesAppRoute(p));
    expect(unmapped).toEqual([]);
  });

  it.each(['', '/nope', '/o/acme/nope', '/o/acme/drift', '/o/acme/p/web/nope', 'login'])(
    'rejects %j',
    (pathname) => {
      expect(matchesAppRoute(pathname)).toBe(false);
    },
  );

  it.each(['/o/acme/p/web/drift?x=1', '/o/acme/p/web/drift/', '/o/acme', '/o/acme/', '/login/', '/'])(
    'normalizes and accepts %j',
    (pathname) => {
      expect(matchesAppRoute(pathname)).toBe(true);
    },
  );
});
