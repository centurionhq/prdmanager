/**
 * Mapa puro de las rutas reales de la SPA. Existe para que el server responda 404 de verdad (status HTTP)
 * en vez de servir `index.html` con 200 para cualquier URL desconocida (WO-641 / SDD-071).
 *
 * Lo mantiene atado a `packages/app/src/router.tsx` el test
 * `packages/app/tests/unit/app-route-map.test.ts`: si alguien agrega una ruta allá y no acá, ese test falla.
 *
 * `matchesAppRoute` corta el pathname en el primer `?`, tolera UNA barra final y excluye el catch-all `*`
 * del router (no es una ruta real). Un `:param` matchea cualquier segmento no vacío sin `/`.
 */

// `arbol/:id?` del router son dos patrones; los `index: true` son el path del padre.
const APP_ROUTE_PATTERNS = [
  '/',
  '/login',
  '/reset-password',
  '/invite/:id',
  '/admin',
  '/settings/tokens',
  '/o/:orgSlug',
  '/o/:orgSlug/ajustes/miembros',
  '/o/:orgSlug/ajustes/auditoria',
  '/o/:orgSlug/ajustes/perfil',
  '/o/:orgSlug/ajustes/tokens-personales',
  '/o/:orgSlug/p/:projectSlug',
  '/o/:orgSlug/p/:projectSlug/construir/negocio',
  '/o/:orgSlug/p/:projectSlug/construir/developer',
  '/o/:orgSlug/p/:projectSlug/construir/producto',
  '/o/:orgSlug/p/:projectSlug/arbol',
  '/o/:orgSlug/p/:projectSlug/arbol/:id',
  '/o/:orgSlug/p/:projectSlug/documents',
  '/o/:orgSlug/p/:projectSlug/documents/:docId',
  '/o/:orgSlug/p/:projectSlug/ordenes',
  '/o/:orgSlug/p/:projectSlug/drift',
  '/o/:orgSlug/p/:projectSlug/entrada',
  '/o/:orgSlug/p/:projectSlug/ajustes',
  '/o/:orgSlug/p/:projectSlug/ajustes/general',
  '/o/:orgSlug/p/:projectSlug/ajustes/miembros',
  '/o/:orgSlug/p/:projectSlug/ajustes/tokens',
  '/o/:orgSlug/p/:projectSlug/ajustes/tokens-personales',
  '/o/:orgSlug/p/:projectSlug/ajustes/perfil',
  '/o/:orgSlug/p/:projectSlug/ajustes/auditoria',
  '/o/:orgSlug/p/:projectSlug/settings',
  '/o/:orgSlug/p/:projectSlug/graph',
];

const APP_ROUTE_REGEXES = APP_ROUTE_PATTERNS.map((pattern) => {
  const source = pattern
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${source}$`);
});

export function matchesAppRoute(pathname: string): boolean {
  const path = pathname.split('?')[0]!;
  if (!path.startsWith('/')) return false;
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return APP_ROUTE_REGEXES.some((re) => re.test(normalized));
}
