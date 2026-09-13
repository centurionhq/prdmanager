---
id: SDD-005
type: SDD
title: "Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape"
status: active
architects: ["PRD-004"]
impacts_paths: ["packages/web/src/**", "packages/web/tests/**", "packages/web/package.json", "packages/web/tsconfig*.json", "packages/web/vite.config.ts", "packages/web/playwright.config.ts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.base.json", "tsconfig.test.json", "vitest.config.ts", ".env.example", "README.md", ".github/workflows/prdm-sync.yml", ".gitignore", "packages/testkit/src/**"]
created_at: 2026-09-13
tags: ["web-ui", "fastify", "react", "cytoscape", "dogfooding"]
---

## Contexto

PRD-004 pide un explorador local de solo lectura del Feature Tree y del drift. Stack en ADR-004. `@prdm/core` ya expone todo lo necesario (`GraphStore`, `Engine.inspect()`, `buildForest`, `computeMetrics`, `ID_PATTERN`, `NODE_LABELS`, `WORK_ORDER_STATUSES`, `scanDocuments`); este SDD no modifica el core.

`impacts_paths` incluye a propósito los archivos compartidos de la raíz (incluido `tsconfig.base.json` y `packages/testkit/src/**`, gobernados hoy por SDD-002 cuyos WOs están todos `done`): los WOs de SDD-001..004 no pueden cubrir `Refs:` de commits que toquen esos archivos. **Deliberado y permanente:** listar `package.json`, `package-lock.json`, `README.md` y `.env.example` aquí significa que, mientras SDD-005 siga siendo el blueprint más reciente que los gobierna, cualquier cambio futuro a esos archivos (no solo durante PRD-004) necesitará un WO abierto de este SDD o de uno posterior que los vuelva a listar — el mismo patrón que ya rige `tsconfig.json`/`vitest.config.ts` desde SDD-002.

**Deliberadamente NO listado:** `docker-compose.yml`, `scripts/**`, `.mcp.json` (gobernados por ADR-001; esta feature no los toca) y `packages/core/src/**` (el core no cambia; si un endpoint futuro necesitara un export nuevo de `@prdm/core`, eso es un cambio de blueprint, no un commit silencioso).

`packages/web/**` se evita a propósito como patrón: incluiría `dist/`, `*.tsbuildinfo`, `test-results/` y `playwright-report/` aunque estén en `.gitignore` (los patrones de `ignore` de `.prdm.yaml` son root-anchored y no cubren rutas anidadas — bug conocido y fuera de alcance de esta SDD), produciendo drift `code_out_of_sync` imposible de reconciliar en cada build. Se listan en cambio los subdirectorios de código fuente explícitamente.

## Arquitectura

```
packages/web/
  src/server.ts        bootstrap: discoverProjectRoot → loadConfig → connect → verify →
                       assertSchemaCurrent → forProject → Engine → buildApp → listen(127.0.0.1)
  src/app.ts           buildApp({config, store, engine, staticDir?}): Fastify sin process/env/listen
  src/errors.ts        ValidationError / NotFoundError + setErrorHandler + setNotFoundHandler
  src/security-headers.ts   hook onSend con CSP y cabeceras (solo en producción)
  src/summary.ts       resumen de proyecto sin campos de autoría
  src/api/*.ts         un plugin por grupo de rutas
  src/client/**        SPA React (Vite)
```

Dependencias en una sola dirección: `web → @prdm/core`. `web` no importa `@prdm/mcp` ni `@prdm/cli`.

### Build: servidor y cliente no comparten `dist`

`tsc -b` y `vite build` compilan programas distintos y no pueden emitir al mismo directorio (Vite hace `emptyOutDir` por defecto y borraría el servidor compilado). `packages/web/tsconfig.json` es un archivo solución (`files: [], references: [{path: "./tsconfig.server.json"}, {path: "./tsconfig.client.json"}]`), y el root `tsconfig.json` referencia `packages/web` (ese archivo solución, igual que hoy referencia a `core`/`cli`/`mcp`).

- `tsconfig.server.json`: extiende `../../tsconfig.base.json`, `rootDir: src`, `outDir: dist/server`, `exclude: ["src/client/**"]`, `references: [{path: "../core"}]`. Cubre `server.ts`, `app.ts`, `errors.ts`, `security-headers.ts`, `summary.ts`, `api/**`.
- `tsconfig.client.json`: **no** extiende `tsconfig.base.json` (ese archivo fija `module`/`moduleResolution: nodenext` y `types: ["node"]`, incompatibles con un bundle de navegador). Config propia: `target: es2023`, `module: esnext`, `moduleResolution: bundler`, `jsx: react-jsx`, `lib: ["es2023","dom","dom.iterable"]`, `types: ["vite/client"]`, `verbatimModuleSyntax: true`, `strict: true`, `noEmit: true`, `composite: true`, `rootDir: src/client`, `references: [{path: "../core"}]` (la referencia resuelve `@prdm/core` a `dist/index.d.ts` vía la condición `types` de sus `exports`, sin tocar sus fuentes Node). Vite (`vite build`) usa esta misma carpeta como `root` lógico; `outDir: dist/client`, `emptyOutDir: true`.
- Regla verificable: el cliente solo hace `import type` de `@prdm/core` (nunca un import de valor — arrastraría `neo4j-driver`/`node:fs` al bundle del navegador). `verbatimModuleSyntax: true` lo fuerza a nivel de tipos; se agrega además un test/script que grepea `src/client/**` en busca de un `import` de `@prdm/core` sin `type` y falla si aparece.
- `server.ts` sirve estáticos desde `staticDir` (por defecto `dist/client`, inyectable en `buildApp` para tests con un directorio temporal).

### Contrato HTTP

Todas `GET`, sin prefijo de versión (una sola superficie local con un único cliente, el SPA empaquetado). Éxito: cuerpo plano, sin envoltorio. Todas las respuestas `/api/*` con `Cache-Control: no-store`. Validación con zod `safeParse` sobre `params`/`query`.

| Ruta | Params / query (zod) | 200 | Errores | Delega en |
|---|---|---|---|---|
| `/api/health` | — | `{status:'ok'}` | — | — (no toca Neo4j) |
| `/api/project` | — | `WebProjectSummary` | 500 | `summary.ts` (`scanDocuments`) |
| `/api/node/:id` | `id` ~ `ID_PATTERN` | `NodeDetail` | 400, 404 | `store.getNode` |
| `/api/search` | `q` 1..200, `labels?` csv ⊂ `NODE_LABELS` (desconocida → 400), `limit` 1..100 def. 10 | `SearchHit[]` | 400 | `store.search` |
| `/api/branch/:id` | `id` ~ `ID_PATTERN` | `Subgraph` | 400, 404 | `store.getNode` → `store.branch` |
| `/api/full-graph` | — | `Subgraph` (vacío es válido) | 500 | `store.fullGraph` |
| `/api/tree` | `root?` ~ `ID_PATTERN` | `{forest: TreeNode[]}` | 400, 404 | `getNode` → `branch`/`fullGraph` → `buildForest` (espejo de `packages/cli/src/commands/graph.ts` `loadTreeGraph`) |
| `/api/work-orders` | `status?` ∈ `WORK_ORDER_STATUSES`, `blueprint?` ~ `ID_PATTERN` | `WorkOrderSummary[]` | 400 | `store.listWorkOrders` |
| `/api/work-orders/:id` | `id` ~ `ID_PATTERN` | `WorkOrderContextRaw` | 400, 404 | `store.workOrderContext` |
| `/api/drift` | — | `RefreshReport` | 500 | `engine.inspect()` — **nunca** `refresh()` |
| `/api/metrics` | — | `SuccessMetrics` | 500 | `computeMetrics(await store.metricsRaw())` |

**404 de `branch`:** `BRANCH` devuelve un subgrafo vacío tanto para un id inexistente como para un nodo aislado; por eso `branch` y `tree?root` hacen `getNode` primero (mismo patrón que la CLI).

**JSON-safety:** el driver usa `disableLosslessIntegers: true` (`graph/database.ts`) y el snapshot solo escribe strings/booleans/arrays normalizados por `frontmatterSchema`; ningún tipo de respuesta contiene `Integer`, `Date`, `Map` ni `BigInt`.

**`WebProjectSummary`** = `{id, name, folders, lifecycle, counts}`. No incluye `openDrafts`/`draftableKinds`: la autoría no existe en este paquete y un "0 borradores" sería falso.

### Errores

```ts
interface ApiError { error: { code: 'validation_error' | 'not_found' | 'internal_error'; message: string } }
```

| Caso | Status | message |
|---|---|---|
| zod falla | 400 | primer issue de zod, sin path interno |
| `null` de core o id desconocido | 404 | `"<id> not found"` |
| ruta `/api/*` inexistente | 404 JSON | `"route not found"` — nunca `index.html` |
| cualquier otra excepción | 500 | `"internal error"` fijo; el error completo solo va al logger. Nunca `err.message`: los errores del driver pueden incluir la URI de Neo4j |

Un único `setErrorHandler` central; los handlers lanzan `ValidationError`/`NotFoundError`. `setNotFoundHandler` distingue `/api/` (JSON 404) del resto (fallback SPA a `index.html`). Las rutas `/api` se registran antes que `@fastify/static`.

### Ciclo de vida del Engine en un proceso de larga duración

- **Nunca se llama `engine.recover()` ni `engine.refresh()` en `packages/web`** (a diferencia de `packages/mcp/src/server.ts`, que sí refresca al iniciar): este proceso es de solo lectura estricta, y `recover()` puede ejecutar un `doRefresh()` completo (escribe). Si `.prdm/graph-stale` existe (`graphStaleMarkerExists`, ya exportado por `@prdm/core`), `/api/project` y el layout de la SPA muestran un aviso "índice desacoplado del repo — correr `prdm sync`" en vez de refrescar por su cuenta. Esto también documenta por qué `/api/tree` (snapshot de Neo4j) puede diferir momentáneamente de `/api/drift` (lectura en vivo del disco): son fuentes distintas a propósito.
- **`/api/drift` con single-flight + TTL corto:** `engine.inspect()` re-escanea todo el repo, re-hashea símbolos con Tree-sitter y lee hasta 500 commits de git — no es barato. Se cachea una promesa en curso (evita ejecutar dos inspecciones concurrentes si el usuario hace doble clic en "Actualizar" o tiene dos pestañas) y el último resultado por ~2s (TTL corto, no un caché real: sigue sin haber refresco automático por polling).
- El caché de símbolos (`.prdm/symbol-cache.json`) solo se lee en `inspect()` (`collect()`), nunca se persiste desde este proceso — a diferencia del CLI/MCP, que sí lo guardan tras un `refresh()`. No "optimizar" esto a escritura: rompería la garantía de solo lectura.
- `app.addHook('onClose', () => db.close())` + `SIGINT`/`SIGTERM` en `server.ts` (mismo patrón que `packages/mcp/src/server.ts`), cerrando el driver de Neo4j de forma ordenada.

### Seguridad

- Bind `127.0.0.1` por defecto (`PRDM_WEB_HOST` para cambiarlo), puerto `PRDM_WEB_PORT` (def. 4600). Sin auth, sin CORS (mismo origen; en desarrollo, proxy de Vite).
- **Protección contra DNS rebinding:** bindear a `127.0.0.1` no es un límite de seguridad por sí solo — cualquier página que el usuario visite puede resolver un hostname a `127.0.0.1` y disparar `fetch` contra este puerto desde un origen que el navegador trata como válido. Un hook `onRequest` rechaza (403) toda petición cuyo header `Host` no sea exactamente `127.0.0.1:<puerto>` o `localhost:<puerto>`. `PRDM_WEB_HOST` distinto de loopback solo se acepta si además se define `PRDM_WEB_ALLOW_REMOTE=1`; sin esa variable, `server.ts` rehúsa arrancar con un bind no-loopback.
- Solo `GET`; ninguna ruta escribe baseline, snapshot ni documentos.
- Producción: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Sin HSTS (HTTP en loopback). Hook propio en `security-headers.ts` en lugar de `@fastify/helmet`: son 3 cabeceras fijas.
- Frontend: títulos de documentos se renderizan como texto (React escapa; labels de Cytoscape son texto de canvas, nunca HTML). Sin `dangerouslySetInnerHTML`.
- Tipografía: pila del sistema (`system-ui` / `ui-monospace`), sin archivos de fuente ni Google Fonts (decisión de ADR-004) — no hay nada que "servir localmente", cero peticiones de red para tipografía.

### Frontend

- `api/client.ts`: fetch tipado con los tipos de `@prdm/core` (`import type`, sin código del core en el bundle), convierte `ApiError` en `ApiClientError`.
- `graph/to-elements.ts`: `Subgraph → cytoscape.ElementDefinition[]`, función pura (ids de arista `${from}-${type}-${to}`).
- `hooks/useGraphData`: estados `loading | error | ready`, `refetch`.
- `hooks/useCytoscape`: crea `cy` una vez (vía una factory inyectable — ver Tests, `headless: true` en jsdom); en refresco `cy.json({elements})` preservando pan/zoom; `destroy()` al desmontar.
- `graph/apply-drift.ts`: `applyDrift(elements, report: RefreshReport) → elements'`, función pura que anota cada elemento cuyo id aparece en `report.issues[].nodeId` o en `report.governed[]` con `data.drift = true`; es la única fuente de la insignia de drift en el canvas (el `status`/`reviewNeeded` del propio nodo, ya presente en `Subgraph`, sigue viniendo del snapshot vía `to-elements.ts`). Con tests unitarios propios.
- `state/selection.ts`: estado de selección compartido (id de nodo activo) vía un `useState`/contexto mínimo en `App.tsx`, sin librería — lo consumen `GraphCanvas`, la vista de árbol, `SearchBar` y `NodeDetailPanel` para mantenerse sincronizados (seleccionar en el árbol resalta en el canvas y actualiza el panel, y viceversa).
- `styles/graph-stylesheet.ts`: forma por label (Feature rectángulo redondeado, Blueprint hexágono, WorkOrder elipse, Feedback/Artifact rombo), color+trazo por estado, drift/`reviewNeeded` en ámbar con trazo discontinuo e insignia. Nunca solo color.
- Layout: árbol navegable por teclado (`role="tree"`, alternativa accesible al canvas) · canvas · panel de detalle; Work Orders debajo; se apila en pantallas angostas. Tema oscuro por defecto y claro completo, tokens semánticos en `tokens.css`.
- `/api/drift` recorre el repo completo: se pide al cargar y con "Actualizar", nunca por polling automático.
- `/api/full-graph` no tiene tope; con más de 500 nodos se muestra un aviso sugiriendo navegar por rama, sin truncar.

### Cómo se corre

- **Producción/dogfooding:** `npm run build && npm run build --workspace=@prdm/web` (compila servidor y cliente), luego `npm run web` (`node packages/web/dist/server/server.js`, sirve `dist/client` desde el propio Fastify) — este es el flujo al que se refiere el criterio de éxito de PRD-004.
- **Iteración visual (F4):** dos procesos — `npm run web:api` (Fastify vía `tsx`, sin build) en una terminal y `npm run dev --workspace=@prdm/web` (Vite, `localhost:5173`, proxy de `/api` al puerto de Fastify) en otra.

### Tests

- **vitest 4 usa `test.projects`, no `environmentMatchGlobs`** (removido en v4): `vitest.config.ts` define un proyecto `node` (glob existente `packages/*/tests/**/*.test.ts`, ahora también con `.test.tsx` para cubrir `tests/client`... no — ver siguiente punto) y un proyecto `jsdom` acotado a `packages/web/tests/client/**/*.test.tsx` con `environment: 'jsdom'` y su propio `fileParallelism: false`. El include raíz (`packages/*/tests/**/*.test.ts`) y el de cobertura (`packages/*/src/**/*.ts`) se actualizan a `{ts,tsx}` para no perder los nuevos archivos `.tsx`. `tests/e2e/**` usa la extensión `.spec.ts` (convención de Playwright) y se excluye explícitamente del include de vitest para que ambos runners nunca compitan por el mismo archivo.
- `tests/unit`: summary, errors, esquemas zod, to-elements, apply-drift, security-headers, validación del header `Host`.
- `tests/integration`: `buildApp` + `app.inject()` contra Neo4j de test (7688) con fixture de testkit; un archivo por grupo de rutas; verifica que `/api/drift` no modifica `.prdm/baseline.json` ni `.prdm/symbol-cache.json` (mtime sin cambios) y no llama `store.writeSnapshot`.
- `tests/client`: jsdom 27.4.0 + Testing Library, fetch mockeado. **`useCytoscape` no puede usar el renderer por defecto de Cytoscape bajo jsdom** (no hay `canvas`, y jsdom 27 solo soporta `canvas` como peer opcional que este repo no instala): el hook recibe una factory de Cytoscape inyectable, y el test la llama con `cytoscape({ headless: true, elements })` (sin contenedor DOM, sin renderer) para verificar las llamadas a `cy.json()`/`cy.destroy()` sin necesitar canvas real.
- `tests/e2e` (`*.spec.ts`, Playwright): recorrido principal contra servidor real sirviendo el bundle. **Solo local por ahora** (no se agrega a `.github/workflows/prdm-sync.yml`): sumar Playwright a CI implica instalar Chromium (`npx playwright install --with-deps chromium`) y cachearlo en el runner, un costo que esta SDD prefiere diferir a cuando haya más de un flujo E2E que justifique mantenerlo en CI. La compuerta de CI sigue siendo `test:unit` + `sync --check`; el E2E se corre a mano antes de abrir el PR (ver Verificación en el PRD/plan).
- `/api/health` no verifica Neo4j a propósito (arranca antes que la conexión importe para un liveness check trivial); por eso el `webServer` de Playwright puede considerarlo listo con la base de datos caída — el propio recorrido E2E lo expone igual en el primer paso real (`/api/project` o `/api/tree` fallarían con 500), así que no se añade una variante `?deep=1` en esta iteración (documentado, no resuelto).
- Cobertura: `src/server.ts` y `src/client/**` fuera del umbral global; backend (`src/api/**`, `src/app.ts`, `src/errors.ts`, `src/summary.ts`, `src/security-headers.ts`) dentro de 80/80/80/70.

## Tareas

Nota general: cualquier tarea que agregue una dependencia nueva debe incluir `package-lock.json` en el mismo commit (si no, `npm ci` rompe en CI).

- [ ] Scaffold mínimo de packages/web: tsconfig.json (solución), tsconfig.server.json, tsconfig.client.json, y un src/server.ts / src/client/main.tsx stub (para que tsc -b tenga inputs y no falle con TS18003)
- [ ] Cableado de la raíz: referencia a packages/web en tsconfig.json, vitest.config.ts con test.projects (node + jsdom) e includes .ts/.tsx corregidos, tsconfig.test.json con los archivos de packages/web, .gitignore con dist/ test-results/ playwright-report/ blob-report/ playwright/.cache/ de packages/web
- [ ] Harness de tests de integración (buildApp + app.inject + fixture de testkit contra Neo4j de test) construido junto con app.ts en la misma tarea, ya que el harness necesita que buildApp exista para compilar
- [ ] summary.ts con resumen de proyecto sin campos de autoría y sus tests unitarios
- [ ] errors.ts con ValidationError, NotFoundError, setErrorHandler central y setNotFoundHandler que distingue /api/ (404 JSON) del resto, y sus tests unitarios
- [ ] app.ts con la factory buildApp, los esquemas zod compartidos de params y query, y el harness de integración de la tarea anterior verificando que arranca y cierra limpio
- [ ] server.ts con bootstrap, validación del header Host y PRDM_WEB_ALLOW_REMOTE, bind a 127.0.0.1, PRDM_WEB_PORT, hook onClose y apagado ordenado por SIGINT/SIGTERM, y sus tests
- [ ] Endpoint GET /api/health y GET /api/node/:id con sus tests de integración
- [ ] Endpoint GET /api/search con labels csv validadas y limit acotado, y sus tests
- [ ] Endpoints GET /api/branch/:id con precheck de getNode y GET /api/full-graph, y sus tests
- [ ] Endpoint GET /api/tree con root opcional, y sus tests
- [ ] Endpoints GET /api/work-orders con filtros y GET /api/work-orders/:id, y sus tests
- [ ] Endpoint GET /api/drift con engine.inspect, single-flight y TTL corto, verificando que no escribe baseline ni symbol-cache, y sus tests
- [ ] Endpoints GET /api/metrics y GET /api/project (sin campos de conexión a Neo4j), y sus tests
- [ ] Shell de Vite y React: index.html, main.tsx, App vacío, tokens.css con tema oscuro y claro, build de vite compilando a dist/client
- [ ] Servir el bundle con @fastify/static desde dist/client, fallback SPA, cabeceras de seguridad de producción, y tests de fallback SPA y de path traversal
- [ ] Cliente de API tipado (import type de @prdm/core, sin import de valor) con manejo de ApiError, y sus tests con guard contra imports de valor del core
- [ ] Función pura to-elements de Subgraph a elementos de Cytoscape, y sus tests
- [ ] Función pura apply-drift que anota elementos con la insignia de drift a partir de un RefreshReport, y sus tests
- [ ] Hook useGraphData con estados loading, error y ready, y sus tests
- [ ] Hook useCytoscape con factory inyectable, creación única, refresco con cy.json y destroy al desmontar, y sus tests con cytoscape headless
- [ ] Estado de selección compartido (selection.ts) consumido por canvas, árbol, búsqueda y panel de detalle, y sus tests
- [ ] graph-stylesheet con forma por tipo, color y trazo por estado y marcador de drift
- [ ] GraphCanvas con layout, encuadre y botón Actualizar preservando pan y zoom
- [ ] Vista de árbol accesible por teclado sincronizada con el estado de selección compartido
- [ ] SearchBar con debounce, atajo de teclado y foco en el nodo elegido vía el estado de selección
- [ ] NodeDetailPanel con metadata, relaciones y work orders asociados
- [ ] WorkOrderList de solo lectura con filtros por estado y blueprint
- [ ] DriftBanner y resaltado de nodos con drift en el canvas usando apply-drift
- [ ] Estados de carga, vacío y error con sus tests
- [ ] Auditoría de accesibilidad: navegación completa por teclado del árbol y el detalle, aria-labels, contraste 4.5:1 de los tokens en ambos temas
- [ ] Corregir el encuadre inicial del canvas: fit() llamado en el mismo tick que la creación de cy ve el contenedor con tamaño 0 y produce un layout colapsado en cada carga a escala real de este repo; diferirlo un frame con requestAnimationFrame (cancelado si el componente se desmonta antes) y sus tests
- [ ] E2E con Playwright del recorrido principal (cargar, buscar, seleccionar, ver detalle, ver drift) contra servidor real y Neo4j, corrido localmente (no en CI, ver Tests)
- [ ] README con sección Web UI (incluyendo cómo correr en modo iteración con dos procesos), .env.example con PRDM_WEB_PORT, retiro de "UI web" de Fuera del MVP
- [ ] Paso de build de @prdm/web en el workflow de CI (después de que el frontend compile)
- [ ] Correcciones del review paralelo de arquitectura/seguridad/rendimiento (F6): isAllowedHost no reconocía [::1] aunque resolveWebBind sí lo aceptaba como loopback (arrancaba y luego rechazaba todo con 403); un nodo nuevo introducido entre refrescos quedaba en (0,0) para siempre al no re-correr layout; el stylesheet del canvas no se reaplicaba ante un cambio en vivo de tema del SO; el guard de imports de @prdm/core no detectaba un import() dinámico; el test de path traversal no afirmaba el status code; y sus tests
- [ ] Dogfooding: comparar la respuesta de /api/tree?root=PRD-004 contra buildForest usado por la CLI, sync --check en 0, cierre de PRD-004
