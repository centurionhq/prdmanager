---
architects: ["PRD-007"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
tags: ["saas","api","lifecycle","drift","feedback"]
id: "SDD-012"
type: "SDD"
title: "API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código"
created_at: "2026-09-15"
---

## Contexto

PRD-007 conecta el frontend rediseñado a la API real. La investigación encontró que buena parte de lo que las pantallas del canvas necesitan hoy solo existe como herramienta MCP (`packages/mcp/src/tools-read.ts`, `tools-remote.ts`), o no existe en absoluto: no hay ninguna función que derive la estación de ciclo de vida de una feature, ni un resumen agregado por proyecto, ni una transición de triaje de feedback, ni un endpoint de detalle de un reporte de drift.

Además hay un defecto de integridad verificado en el código: `PgProjectEngine.buildDriftInput` (`packages/server/src/engine/pg-project-engine.ts:897`) siempre pasa `governed: new Map()`. `reconcileBaseline` (`packages/core/src/sync/monitor.ts:271`) construye `baseline.governs` únicamente a partir de `ctx.governed`, así que cada `refresh()` en modo SaaS reescribe la baseline de código gobernado sin nada dentro, incluso si el reporte de CI que se acaba de procesar (`packages/server/src/api/code-reports.ts`) trajo un `governed[]` real. Efectos concretos: `detectDrift` nunca puede comparar contra un `base` previo, así que `code_changed` no se dispara jamás en SaaS; `buildSnapshot` no proyecta ningún nodo `CodeRef` ni relación `GOVERNED_BY` en Neo4j; `systemIntegrity` de `get_metrics` queda siempre en `0/0`; el contexto de una orden de trabajo (`getWorkOrderContext`) nunca trae código gobernado; y una baseline subida por `prdm link --import` se pierde en el primer refresh posterior.

Este SDD agrega las rutas HTTP que faltan, siguiendo exactamente el patrón ya establecido en SDD-006/007 (`requireAppSession` → resolución de organización y proyecto visibles → `can(subject, action)` → CSRF en mutaciones → 404 ante cualquier recurso de otra organización o proyecto), y corrige la persistencia de la baseline de código.

**Sobre `impacts_paths`:** se re-listan `package.json`, `package-lock.json`, `vitest.config.ts` y `tsconfig.test.json` porque las WOs de SDD-006/007/008/009/010 que los gobernaban están todas `done` (precedente de SDD-005/ADR-007). `packages/mcp/src/**` se incluye porque algunas rutas nuevas envuelven funciones de dominio que hoy solo exponen las tools MCP (`get_work_order_context`, `submit_feedback`, `triage_feedback`), y ese código puede necesitar extraerse a una forma reusable por HTTP y MCP a la vez.

## Diseño

### Contratos (`packages/contracts/src`)

- **`lifecycle.ts`** (nuevo): `STATIONS` (las seis de PRD-002 §3: `ingesta`, `definicion`, `diseno`, `planificacion`, `ejecucion`, `cierre`), `featureLineSchema` (id, kind, título, status, station, andonStation opcional, progreso `{done, total, stopped}`), `lineBoardSchema` (`{features: featureLineSchema[], andon: {featureId, station} | null}`), `projectOverviewSchema` (extiende los campos ya existentes de `projectSummarySchema` con `docCount`, `furthestStation`, `andonStation`, `driftErrors`, `driftWarnings`, `awaitingFirstReport`, `workOrdersInProgress`, `myRole`, `lastActivityAt`).
- **`work-orders.ts`** (nuevo): DTO de contexto de orden (objetivo, criterios, blueprint, código gobernado, commits) que ya arma `core/src/workorders/context.ts`, más los payloads de `claim`/`complete`.
- **`feedback.ts`** (nuevo): `inboxItemSchema` (FB/ART con status, fuente, links, `receivedAt`), payload de `submitFeedback`, y `candidateSchema` (featureId, score, reason) para el resultado de `triageText`.
- **`code-refs.ts`** (nuevo): forma de una fila `project_code_refs` más su veredicto de sincronía.
- **`commits.ts`** (nuevo): forma de una fila de la tabla `commits` (sha, subject, author, date, refs, files, trust).
- **`drift.ts`** (extendido): `driftIssueDtoSchema` = un `DriftIssue` más `{id (sha256 hex de `kind|nodeId|target|message`, primeros 16 caracteres), featureIds: string[], blueprintId: string | null, station: Station | null, detectedAt}`, y `driftReportDetailSchema` (el reporte más su lista de issues).
- **`metrics.ts`, `search.ts`, `audit.ts`** (nuevos): forma de `Metrics` (ya existe en core, solo se expone), resultado de `search_nodes`, y una fila de audit log ya redactada.
- Extensiones menores: `organizationMemberSchema`/`projectMemberSchema` ganan `lastActiveAt`; `tokenSummarySchema` (CI) gana `createdByName`.

### Core (`packages/core/src`)

**`lifecycle/station.ts`** (nuevo, mismo estilo que `lifecycle/close.ts`): `deriveLineBoard(docs: ParsedDoc[], issues: DriftIssue[]): LineBoard`, pura, sin I/O. Por cada feature, la primera regla que aplica gana:

| Estación | Regla |
|---|---|
| `cierre` | La feature está `closed`, o tiene al menos una orden y todas están `done` (fila con nota "falta reconocer" si aplica) |
| `ejecucion` | Alguna orden de un blueprint que la arquitecta está `in_progress`, `done` o `out_of_sync` |
| `planificacion` | Tiene órdenes y todas están `pending` |
| `diseno` | La feature está `approved`, o algún blueprint la arquitecta (`ARCHITECTS`) aunque no tenga órdenes todavía |
| `definicion` | La feature está justificada (`justified_by`, o un FB/ART que la informa) |
| `ingesta` | Ninguna de las anteriores |

`progress.done`/`total` cuentan las órdenes alcanzables vía `ARCHITECTS → IMPLEMENTS`; `stopped` cuenta las `out_of_sync`.

**`sync/issue-attribution.ts`** (nuevo): `attributeIssue(issue: DriftIssue, docs): {featureIds: string[], blueprintId: string | null, station: Station | null}`:

| Origen del issue | Estación atribuida |
|---|---|
| FB/ART (`broken_link`, `invalid_link_target` sobre un FB/ART) | `ingesta` |
| Feature (`feature_changed`, violaciones de ciclo de vida) | `definicion` |
| Blueprint (`blueprint_changed`, `impacts_warning`, `awaiting_ci_report`) | `diseno` |
| Orden (`work_order_out_of_sync`) y `code_out_of_sync` (cuyo `nodeId` es el blueprint) | `ejecucion` |

El andon de una feature es la estación más temprana con al menos un issue de severidad `error` que la atribuye. El andon del proyecto (para `projects/overview`) es el más temprano entre todas sus features. Estas reglas son una decisión de producto: se validan con el usuario en la ronda de canvas B de SDD-013, y esta tarea queda abierta a un ajuste menor de las tablas si esa ronda lo pide.

**`feedback/link.ts`** (nuevo): `triageFeedback(engine, id, {informs, root?})`: valida que el feedback exista y esté `new`, aplica el enlace `informs` (o `root: true`) con las mismas reglas de `createFeatureRequest`, y fija `status: 'triaged'` (campo string libre, sin cambio de schema). Si el documento es `origin: 'collab'`, la operación devuelve un resultado que indica que el enlace se aplicará recién al republicar (vía el mecanismo de `pending_editable_patch` que ya usa `createFeatureRequest` sobre documentos con copia de trabajo); si es `origin: 'generated'`, se aplica de inmediato sobre `published_raw`.

### Persistencia de la baseline de código

**Migración `0018_project_code_refs.sql`:**
- Tabla `project_code_refs`: `project_id`, `org_id`, `blueprint_id`, `ref_key`, `path`, `symbol` (nullable), `hash` (nullable), `hash_algo_version`, `report_id`, `head_sha`, `updated_at`. Clave primaria `(project_id, blueprint_id, ref_key)`. FK compuesta `(project_id, org_id) → projects(id, org_id)`. RLS habilitado y forzado con la misma política `org_id = NULLIF(current_setting('app.org_id', true), '')` que usa la migración `0015`. Grants para `prdm_app` (sin `BYPASSRLS`, como toda tabla de este proyecto).
- `project_code_state` gana la columna `governed_warnings jsonb`.

**Escritura:** solo un reporte de código en modo **baseline** (`packages/server/src/api/code-reports.ts`) reemplaza las filas de `project_code_refs` del proyecto, dentro de la misma transacción que ya registra el head de baseline (`recordBaselineHead`). Un reporte de vista previa nunca escribe esta tabla.

**Lectura:** `buildDriftInput` (en vez de `governed: new Map()`) carga las filas de `project_code_refs`, agrupadas por `blueprint_id`, y las entrega como `ctx.governed`. Se excluyen las filas de blueprints que `reconcileByHash` ya marcó como desactualizados (el reconciliado por hash corre antes de construir `governed`, no después), y las filas cuyo `hash_algo_version` no coincide con el de `settings` (igual criterio que ya usa `awaiting_ci_report`).

**Resultado esperado:** `baseline.governs` acumula normalmente entre sincronizaciones; un hash de referencia distinto entre dos reportes produce `code_changed`; un blueprint sin cambios conserva su baseline intacta; `buildSnapshot` proyecta `CodeRef`/`GOVERNED_BY` en Neo4j; `systemIntegrity` deja de ser `0/0`; el contexto de una orden trae código gobernado real.

**Cambio de comportamiento aceptado:** proyectos SaaS existentes van a empezar a mostrar `code_out_of_sync` real, donde antes nunca aparecía nada. Se documenta en el README como nota de release; se revisa explícitamente en el gate de seguridad de este SDD, porque puede bloquear un cierre de feature que antes pasaba solo porque el chequeo era un no-op.

### Rutas nuevas

`P` = `/api/app/organizations/:orgSlug/projects/:projectSlug`. Todas declaran su nivel de acceso en `packages/server/src/access/route-registry.ts`, siguen `requireAppSession` → `resolveVisibleProject`/`requireMemberOrg` → `can(subject, action)`, usan CSRF en las mutaciones, y responden 404 (nunca 403) ante cualquier recurso fuera del alcance del llamante. Cada una gana sondas `crossOrg` y `sameOrgOtherProject` (o solo `crossOrg` para las de nivel organización) en `packages/server/tests/isolation/prd007-routes.ts`, registradas junto a las existentes — `isolation.test.ts` ya falla si una ruta registrada no tiene sonda.

| Método | Ruta | Envuelve | Permiso |
|---|---|---|---|
| GET | `/api/app/organizations/:orgSlug/projects/overview` | agregado Postgres-only por cada proyecto visible; memoizado por `(projectId, graph_version, latestReportId)` | `view` por proyecto |
| GET | `P/line-board` | `deriveLineBoard` sobre `scan()` + `inspect()` | `view` |
| GET | `P/metrics` | `computeMetrics` sobre `store.metricsRaw()` | `view` |
| GET | `P/graph/search?q=&label=&limit=` | `search_nodes` | `view` |
| GET | `P/graph/branch/:nodeId` | `get_feature_branch` | `view` |
| GET | `P/work-orders/:woId/context` | `getWorkOrderContext` | `view` |
| POST | `P/work-orders/:woId/claim` | `claimWorkOrder`; `assignee` siempre `dev:<user_profile.handle>` del usuario en sesión, nunca un texto libre del cliente | `claim_work_order` |
| POST | `P/work-orders/:woId/complete` `{commitSha}` | `completeWorkOrder`; 409 `commit_not_verified_by_ci` si el commit no llegó como baseline con `Refs:` a esa orden | `complete_work_order` |
| POST | `P/feedback` | `submitFeedback` | `submit_feedback` |
| GET | `P/inbox?status=&kind=` | documentos FB/ART con sus links y estado | `view` |
| GET | `P/feedback/:docId/candidates` | `triageText` | `view` |
| POST | `P/feedback/:docId/triage` | `triageFeedback`; 409 explicando el retraso si el documento es `collab` | `edit_document` |
| GET | `P/drift/issues` | `inspect()` enriquecido con `attributeIssue` | `view` |
| GET | `P/drift/reports/:reportId` | fila de `code_reports` con su `result` desplegado en issues individuales | `view` |
| GET | `P/commits?cursor=&limit=&ref=` | tabla `commits`, paginada | `view` |
| GET | `P/code-refs` | `project_code_refs` cruzado con el veredicto de `inspect().governed` | `view` |
| GET | `P/audit-log?cursor=&limit=&action=` | `auditLog.list()` con filtro y cursor agregados | `manage_project_settings` |
| GET | `/api/app/organizations/:orgSlug/audit-log?cursor=&limit=&action=` | igual, a nivel organización | org owner/admin |
| POST | `/api/app/organizations/:orgSlug/invitations/:invitationId/resend` | rota el secreto, extiende el vencimiento, reenvía el email, con el mismo rate limit que crear una invitación, auditado | igual que crear invitación |

No hay ruta nueva `permission action` en `packages/contracts/src/permissions.ts`: `triage_feedback` reutiliza `edit_document` para no tocar la matriz de SDD-006; el resto reutiliza acciones ya existentes (`view`, `claim_work_order`, `complete_work_order`, `submit_feedback` — de existir ya en el enum de acciones; si no, se agregan como acciones nuevas de la matriz, con su fila correspondiente en la tabla de permisos y su test exhaustivo, sin tocar el resto de la matriz).

## Tests

Unitarios de `deriveLineBoard` (una tabla por regla de estación) y de `attributeIssue`. Integración de `buildDriftInput`/`refresh()` contra Postgres y Neo4j de test: dos reportes baseline con un hash distinto producen `code_changed`; un blueprint sin cambios conserva su baseline; `systemIntegrity` es mayor que cero; Neo4j recibe los nodos `CodeRef`. Suite de aislamiento con sondas nuevas para cada ruta, incluida `overview` (un proyecto sin membresía del llamante nunca aparece). Test de que un reporte de vista previa no escribe `project_code_refs`. Test de idempotencia del reemplazo de refs en un reintento de reporte baseline con la misma `Idempotency-Key`.

## Tareas

- [ ] Contratos: `lifecycle.ts` con `STATIONS`, `featureLineSchema`, `lineBoardSchema`, `projectOverviewSchema`, con tests de parseo
- [ ] Contratos: DTO de issue de drift enriquecido, detalle de reporte, `code-refs.ts`, `commits.ts`, con tests
- [ ] Contratos: `work-orders.ts`, `feedback.ts`, `metrics.ts`, `search.ts`, `audit.ts`, extensión de miembros (`lastActiveAt`) y de tokens de CI (`createdByName`), con tests
- [ ] Core: `lifecycle/station.ts` con `deriveLineBoard`, una prueba de tabla por regla de estación
- [ ] Core: `sync/issue-attribution.ts` con `attributeIssue` y el cálculo del andon por feature y por proyecto, con tests
- [ ] Core: `feedback/link.ts` con `triageFeedback`, incluido el caso `collab` (pendiente hasta republicar) y `generated` (inmediato), con tests
- [ ] DB: migración `0018_project_code_refs.sql` (tabla, RLS forzado, FK compuesta, grants, columna `governed_warnings`), con test de catálogo y de aislamiento por organización
- [ ] DB: repositorio de `project_code_refs` (reemplazo transaccional, listado por proyecto), filtro y cursor de `auditLog.list()`, listado paginado de `commits`, con tests
- [ ] Server: el reporte de código en modo baseline persiste `project_code_refs` y `governed_warnings` en la misma transacción que el head de baseline; un reporte de vista previa nunca escribe; reintento con la misma `Idempotency-Key` es idempotente; con tests
- [ ] Engine: `buildDriftInput` lee `project_code_refs` en vez de un mapa vacío, excluyendo blueprints desactualizados por hash y filas de otro `hash_algo_version`, con tests de: `governs` acumula entre sincronizaciones; un hash distinto produce `code_changed`; un blueprint sin cambios queda intacto; Neo4j recibe `CodeRef`/`GOVERNED_BY`; `systemIntegrity` es mayor que 0/0
- [ ] Ruta `GET P/line-board` con su sonda de aislamiento
- [ ] Ruta `GET /api/app/organizations/:orgSlug/projects/overview` memoizada, con su sonda y una prueba de rendimiento sobre 20 proyectos
- [ ] Rutas `GET P/metrics`, `GET P/graph/search`, `GET P/graph/branch/:nodeId` con sus sondas
- [ ] Rutas de orden de trabajo `context`, `claim`, `complete` con sus sondas, incluido el caso `commit_not_verified_by_ci`
- [ ] Rutas `POST P/feedback`, `GET P/inbox`, `GET P/feedback/:docId/candidates`, `POST P/feedback/:docId/triage` con sus sondas
- [ ] Rutas `GET P/drift/issues`, `GET P/drift/reports/:reportId` con sus sondas
- [ ] Rutas `GET P/commits`, `GET P/code-refs` con sus sondas
- [ ] Rutas de audit log de proyecto y de organización con sus sondas y un chequeo de canario en la metadata
- [ ] Reenvío de invitación, `lastActiveAt` de miembros y `createdByName` de tokens de CI, con sus sondas
- [x] Gate: correcciones de la revisión de seguridad (IDOR, alcance de RLS de las rutas nuevas, límites de tasa donde falten, cobertura de auditoría)
- [ ] Gate: correcciones del code review

## Revisión

**Seguridad (WO-344, 2026-09-15).** Sin hallazgos. Se revisaron los 8 vectores previstos (aislamiento entre organizaciones/proyectos, permisos reales contra la matriz de SDD-006, inyección SQL, validación de filtros, fuga de secretos en auditoría, límite de tasa, el fix de `buildDriftInput` y CSRF) contra el código real, no solo la documentación, y se corrieron las suites de aislamiento e integración correspondientes en verde. El único hallazgo posible (sin límite de tasa dedicado en las rutas de órdenes/feedback) resultó ser el mismo patrón ya usado por `documents.ts` para mutaciones de sesión autenticadas y auditadas, no una regresión de SDD-012.
