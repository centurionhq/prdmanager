---
architects: ["PRD-007"]
impacts_paths: ["packages/app/package.json","packages/app/vite.config.ts","packages/app/index.htm[l]","packages/app/src/main.tsx","packages/app/src/styles/**","packages/app/tests/unit/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
tags: ["architecture-decision","design","frontend","saas"]
id: "ADR-008"
type: "ADR"
title: "Port de Centurion Factory a packages/app: tokens, fuentes, íconos, capa de datos y mapa de rutas"
created_at: "2026-09-15"
---

## Contexto

PRD-006 (cerrado) dejó un rediseño visual aprobado en `design/centurion-factory`, un paquete aislado con datos mock (ADR-007/SDD-011). PRD-007 conecta ese diseño al backend real de PRD-005, portando las pantallas a `packages/app`, la SPA que el servidor ya sirve con CSP, CSRF, cliente de API tipado y colaboración en tiempo real (SDD-006..010). `design/centurion-factory` queda congelado como referencia visual: no se borra, para no generar drift `missing` sobre ADR-007/SDD-011.

`packages/app` hoy usa tokens "Stark HUD" de `@prdm/ui` (oscuros, sin relación con los tokens de Centurion Factory) y fuentes de sistema (ADR-004). No tiene loaders ni actions de react-router: cada pantalla busca sus datos en un efecto. `packages/web` (explorador local de PRD-004) también consume `@prdm/ui` y no se toca.

Verificado en el código: `packages/app/vite.config.ts` no tiene `resolve.dedupe: ["yjs"]`, que ADR-006 exige y que el `vitest.config.ts` raíz ya declara. `packages/server/src/spa-html.ts` reemplaza el contenido de `<meta name="csp-nonce" content="" />` con un string exacto: ese tag debe existir carácter por carácter en el `index.html` nuevo. `packages/app/tests/unit/no-core-value-import.test.ts` prohíbe importar valores de `@prdm/core` en la app: ninguna regla de estación o de dominio puede vivir en el frontend.

## Opciones consideradas

| Tema | Opción | Pros | Contras |
|---|---|---|---|
| Ubicación de las pantallas nuevas | **`packages/app/src/features/<pantalla>/`, espejando el paquete de diseño** | Mapeo directo pantalla-por-pantalla desde el canvas aprobado; fácil de auditar contra `design/centurion-factory` | Duplica temporalmente algo de estructura hasta que se borre lo viejo |
| Ubicación de las pantallas nuevas | Reescribir la estructura actual de `packages/app/src/routes` in place | Menos archivos nuevos | Mezcla lo viejo y lo nuevo pantalla por pantalla, más difícil de revisar por PR |
| Tokens | Fusionar los tokens de `@prdm/ui` con los de Centurion Factory | Un solo archivo | Los dos sistemas no comparten nombres ni paleta (uno es oscuro tipo consola, otro es "planta de acero"); fusionarlos arriesga romper `packages/web`, que sigue usando `@prdm/ui` |
| Tokens | **`packages/app` deja de importar `@prdm/ui`; usa su propio `tokens.css` copiado de `design/centurion-factory`** | Aislado, sin riesgo para `packages/web`; permite borrar `@prdm/ui` de `packages/app` cuando se retiran las pantallas viejas | Dos hojas de tokens coexisten en el monorepo (aceptado: son productos visuales distintos) |
| Tipografía | Pila de sistema (ADR-004) | Cero bytes | Contradice el diseño aprobado en canvas |
| Tipografía | **Extender la excepción de ADR-007: `@fontsource-variable/archivo` + `@fontsource/ibm-plex-mono`, self-hosted, mismas versiones** | Sin red, versión fijada, ya validado visualmente en PRD-006 | Sigue sumando peso de bundle (aceptado en ADR-007) |
| Íconos | **lucide-react, misma versión que en `design/centurion-factory`** | Consistencia visual exacta con el canvas aprobado | Una dependencia más en `packages/app` |
| Capa de datos | react-router loaders/actions | Idiomático para v8 en modo data | Reescribe todos los tests existentes (`vi.spyOn(client, …)` + `createMemoryRouter`) y no encaja con la pantalla de colaboración por WebSocket, que vive fuera del ciclo de navegación |
| Capa de datos | TanStack Query | Cache y reintentos listos | Dependencia nueva; ADR-006 ya fijó el stack de datos del cliente sin ella |
| Capa de datos | **`useApiQuery`/`useApiMutation` propios, sobre el mismo `client.ts` barrel** | Mismo patrón de test que ya existe (`vi.spyOn`); los 4 estados (cargando/vacío/error/listo) reemplazan uno a uno a `useDemoState` del mock; sin dependencias nuevas | Menos features que una librería madura (paginación, cache entre pantallas): aceptado, el alcance de PRD-007 no las necesita |

## Decisión

- **Estructura:** `packages/app/src/features/<pantalla>/` espeja las carpetas de `design/centurion-factory/src/features`. Componentes compartidos (Button, StatusBadge, IdTag, Severity, Skeleton, EmptyState, ErrorState, DataTable, FilterChips, SearchField, Modal, Drawer, Toast, PageHeader, Tabs) van a `packages/app/src/components/`, re-exportados desde un índice, igual que en el paquete de diseño.
- **Tokens y estilos:** `packages/app/src/styles/tokens.css` y `base.css` se copian de `design/centurion-factory` con los mismos valores. `main.tsx` deja de importar los tokens de `@prdm/ui`. `packages/web` no cambia.
- **Fuentes e íconos:** `@fontsource-variable/archivo` y `@fontsource/ibm-plex-mono` (mismas versiones exactas que ADR-007) y `lucide-react` (misma versión), como dependencias directas de `packages/app`.
- **Vite:** se agrega `resolve.dedupe: ["yjs"]` a `packages/app/vite.config.ts`.
- **`main.tsx`:** el import de `zod-jitless` sigue siendo el primero del archivo, antes que cualquier import que pueda parsear con zod (WO-157 de SDD-006).
- **`index.html`:** conserva `<meta name="csp-nonce" content="" />` exactamente como lo espera `spa-html.ts`.
- **Capa de datos:** dos hooks nuevos en `packages/app/src/api/`:
  - `useApiQuery<T>(key, fn, deps)` → `{status: 'cargando'|'vacio'|'error'|'listo', data, error, retry()}`, con `AbortController` por navegación y una caché en memoria por `key`.
  - `useApiMutation<T>(fn, {invalidate})` → `{mutate, status, error}`, invalidando las `key` dadas tras un éxito.
  - Ambos llaman siempre a través del barrel `packages/app/src/api/client.ts`, así el patrón de test existente (`vi.spyOn(client, 'metodo').mockResolvedValue(...)`) sigue funcionando sin cambios.
  - `request.ts` gana un manejo global de 401: redirige a `/login?next=<ruta actual>` solo si `next` es una ruta relativa del mismo origen (nunca una URL absoluta), para evitar un open redirect.
- **Mapa de rutas** (`packages/app/src/router.tsx`):
  - Nivel raíz: `/login`, `/reset-password`, `/invite/:id` (intactas: los emails de invitación y reseteo apuntan ahí), `/admin`.
  - `/o/:orgSlug` → Proyectos.
  - `/o/:orgSlug/p/:projectSlug`: `index` → Planta; `arbol/:id?`; `documents`; `documents/:docId` (se conservan estas dos rutas porque el E2E de `packages/server/tests/e2e/full-journey.spec.ts` navega a ellas); `ordenes`; `drift`; `entrada`; `ajustes/{general,miembros,tokens,tokens-personales,perfil,auditoria}`.
  - Nivel organización: `/o/:orgSlug/ajustes/{miembros,auditoria}`.
  - Redirects heredados: `/settings/tokens` → `/o/:org/p/:project/ajustes/tokens-personales` (o al primer proyecto visible si no hay uno activo), `…/graph` → `…/arbol`, `…/settings` → `…/ajustes/general`.
- **Regla de dependencia:** ninguna estación, permiso derivado o regla de negocio del dominio vive en `packages/app`; toda esa lógica llega ya calculada desde `packages/contracts`/el backend (SDD-012), como exige el guard test existente.

## Consecuencias

- `packages/app/package.json` suma `@fontsource-variable/archivo`, `@fontsource/ibm-plex-mono`, `lucide-react` (versiones idénticas a `design/centurion-factory`), y pierde la dependencia de `@prdm/ui` cuando SDD-013 retira las pantallas viejas (tarea final de esa SDD, no de esta ADR).
- Dos hojas de tokens visuales coexisten en el monorepo a propósito: `@prdm/ui` (Stark HUD, para `packages/web`) y la nueva de `packages/app` (Planta de acero). No se fusionan.
- El aumento de peso de bundle por las fuentes self-hosted, ya aceptado en ADR-007, se repite en `packages/app`.

## Tareas

- [ ] Learning test en `packages/server/tests/learning`: sirviendo `packages/app/dist` con el servidor real, confirmar que las fuentes self-hosted y el CSS de CSS Modules cargan sin ninguna violación de la CSP real (`style-src 'self' 'nonce-…'`, `font-src 'self'`) en Chromium
- [ ] Agregar `@fontsource-variable/archivo`, `@fontsource/ibm-plex-mono` y `lucide-react` con las mismas versiones exactas de ADR-007, `resolve.dedupe: ["yjs"]` en `vite.config.ts`, portar `tokens.css` y `base.css` desde `design/centurion-factory`, actualizar `main.tsx` (jitless primero, sin importar los tokens de `@prdm/ui`) y `index.html` (meta de nonce intacta), y portar a `packages/app/tests/unit` los tests de tokens: sin hex fuera de `tokens.css` y contraste AA
