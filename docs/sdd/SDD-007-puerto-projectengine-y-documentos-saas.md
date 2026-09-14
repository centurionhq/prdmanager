---
id: SDD-007
type: SDD
title: "Puerto ProjectEngine y documentos del SaaS sobre Postgres"
status: active
architects: ["PRD-005"]
impacts_paths: ["packages/core/src/**", "packages/core/package.json", "packages/mcp/src/**", "packages/mcp/package.json", "packages/cli/src/**", "packages/web/src/**", "packages/server/src/**", "packages/server/tests/**", "packages/contracts/src/**", "packages/contracts/tests/**", "packages/db/src/**", "packages/db/tests/**", "packages/db/migrations/**", "packages/app/src/**", "packages/app/tests/**", "packages/app/*.json", "packages/testkit/src/**", "docs/model/**", "scripts/validate-graph-model.mjs", "package.json", "package-lock.json", "vitest.config.ts", "tsconfig.test.json"]
created_at: 2026-09-13
tags: ["saas", "engine", "documents", "workflow"]
---

## Contexto

En el SaaS los documentos viven en Postgres (PRD-005), pero todo el dominio de prdm (generar WOs, reclamar y completar, feedback, cierre de features, drift) está escrito contra `Engine`, atado al disco: `transaction()` usa un lock de archivo en `<root>/.prdm/`, `refresh()` escanea `**/*.md`, hashea código local y lee `git log`.

Las funciones de dominio (`generateWorkOrders`, `claimWorkOrder`, `completeWorkOrder`, `submitFeedback`, `createFeatureRequest`, `attachArtifact`, `closeFeature`) usan casi solo `engine.transaction(fn(ops))`, `ops.*`, `engine.config` e `engine.inspect()`. Accesos directos a disco o git relevados:

| Lugar | Acceso | Tratamiento |
|---|---|---|
| `workorders/lifecycle.ts:42,73` | `readCommit(config.root, sha)` | `EngineOps.readCommit` |
| `lifecycle/close.ts:75` | `scanDocuments(config.root)` | `ProjectEngine.scan()` |
| `mcp/src/tools-authoring.ts:56` (`buildProjectSummary`) | `scanDocuments(config.root)` | `ProjectEngine.scan()` |
| `mcp/src/deps.ts` | `engine: Engine`, `authoring: AuthoringService` obligatorios | `engine: ProjectEngine`, `authoring` opcional |
| `mcp/src/tools-drift.ts` `get_drift_report` | `engine.refresh()` (escribe) | en perfil remoto usa `lastReport()` |
| `authoring/service.ts` | `scanDocuments` y `safeReadFile` sobre `config.root` | **solo local** (tipado con `Engine`) |
| `migrate/docs.ts` | baseline en disco | **solo local** |
| `web/src/summary.ts:42` | `scanDocuments` | **solo local** (explorador de PRD-004) |

Además `@prdm/mcp` ejecuta `main()` al importarse y `loadConfig` exige `NEO4J_PASSWORD`.

## Decisión: puerto estrecho, no workspace en disco ni refactor total

| Opción | Problema |
|---|---|
| Materializar cada proyecto en un directorio del servidor | `root_fingerprint` distinto por instancia hace fallar `writeSnapshot`; el lock de archivo no sirve entre instancias; el drift daría todo `missing`; dos copias de la verdad |
| Refactor completo del `Engine` a puertos de almacenamiento | Invasivo sobre journal/lock atómico muy testeado (WO-023) que el modo local necesita intacto |
| **Interfaz `ProjectEngine` implementada por `Engine` (local, sin cambios) y por `PgProjectEngine` (servidor)** | Cambios mínimos y sin alterar el comportamiento local |

```ts
export interface ProjectEngine {
  readonly settings: ProjectSettings;          // sin neo4j ni root; en SaaS vienen de projects.settings
  readonly store: GraphStore;
  transaction<T>(fn: (ops: EngineOps) => Promise<T>, options?: TransactionOptions): Promise<T>;
  refresh(): Promise<RefreshReport>;
  inspect(): Promise<RefreshReport>;
  lastReport(): Promise<RefreshReport | null>; // estado guardado, sin recalcular
  acknowledge(target: string): Promise<RefreshReport>;
  recover(): Promise<RecoverResult>;
  scan(): Promise<ScanResult>;
}
// EngineOps suma readCommit(sha): git local en Engine; commits verificados por CI en PgProjectEngine
```

`Engine` conserva `config: PrdmConfig` para el modo local y expone `settings`. Las funciones de dominio se tipan con `ProjectEngine` y leen `settings`. Guardia en `resolveInside`/`safe-fs` que rechaza raíces no absolutas (una raíz `saas://…` nunca llega a tocar disco). Extracciones puras sin cambio de comportamiento: `scanContents(files)` desde `scanDocuments`; `buildRefreshReport` desde `Engine.collect`/`doInspect`; `loadProjectSettings(root)` desde `loadConfig` (con `assertLocalNeo4j` exportado); `validateDocument` para documentos con id real en fase `edit` (links a no publicados como aviso) y `publish` (bloqueante), sobre las mismas reglas que `validateDraft`. Subpaths nuevos: `@prdm/core/domain` (schemas zod y constantes, seguro para navegador; en `vitest.config.ts` los alias de subpath van antes del alias raíz) y `@prdm/mcp/lib` (`createPrdmServer`, `registerPrdmTools(server, deps, {profile})`, `fenceTag`, `escapeFenceChars`) sin efectos al importar. Guard tests sobre los paquetes `app`, `ui` y `collab` existentes (solo importan valores de `@prdm/core/domain`) y contra importar la raíz de `@prdm/mcp`.

## PgProjectEngine

- **Transacción:** transacción Postgres + `pg_advisory_xact_lock` sobre el uuid del proyecto y cola en proceso; el rollback de Postgres reemplaza al journal.
- **Proyección al grafo con outbox:** dentro de la transacción solo se escribe Postgres y `graph_version = graph_version + 1, graph_dirty = true`. Tras el `COMMIT`, bajo `pg_advisory_lock` de sesión del proyecto, se hace **una sola** `writeSnapshot` (las `ops.refresh()` internas de la transacción se coalescen), se sella `graph_version` en `(:Project)` y `UPDATE … SET graph_dirty = false WHERE graph_version = $v`. `recover()` y cada lectura del grafo re-proyectan si `graph_dirty`. Nunca hay estado del grafo que Postgres no confirmó (reemplaza a ADR-002 D10 en modo SaaS). Huella `saas://project/<uuid>`, igual en todas las instancias.
- **scan:** documentos publicados (`published_raw`) por `scanContents`; `scan().ids` incluye además los `doc_id` de **todos** los documentos del proyecto en cualquier estado y el `last_seq` de `id_counters`, de modo que `nextId` de feedback, feature requests, artefactos y WOs nunca choca con un borrador.
- **Escrituras:** `create/update/replaceDocument` con las mismas reglas que `Engine` (carpeta por kind, `.md`, id inmutable), sobre filas; `createDocument` avanza `id_counters` con `GREATEST` en la misma transacción. Los campos gestionados por el servidor (estado de WO, `closed_*`, `blueprint_hashes`…) se escriben solo en columnas y `published_raw`. Los campos editables que el engine modifica sobre un documento con copia de trabajo (p. ej. `informs` agregado por un feature request) se aplican también a la copia **después del COMMIT**, vía outbox e idempotentes, como transacción de servidor atribuida de SDD-008; nunca con un `UPDATE` directo de `working_state` ni antes del COMMIT (un cambio del `Y.Doc` ya difundido no se puede deshacer si la transacción hace rollback).
- **refresh:** docs publicados + estado de código de la rama por defecto verificado por CI (SDD-010) + `project_baselines` → `detectDrift` → updates de WOs → baseline. `project_code_state` guarda el hash de `impacts_paths` de cada blueprint usado en el reporte; refresh solo reconcilia `governs` de los blueprints cuyo hash coincide, conserva la baseline del resto y emite el aviso `awaiting_ci_report`.
- **readCommit:** solo devuelve commits llegados en reportes baseline (SDD-010); un sha visto solo en vistas previas responde `commit_not_verified_by_ci`.

## Documentos y flujo

Tablas (con `org_id`, FKs compuestas y RLS de SDD-006): `documents` (`doc_id` único por proyecto, `kind`, `title`, `source_path` normalizado a `<carpeta del kind>/<ID>*.md`, `origin` collab/generated/import, `workflow_state`, `working_state` Yjs, `published_version_id`, `published_raw`, `published_content_hash`, `last_validation`), `document_versions` (número, etiqueta, motivo manual/review_request/published/agent_accept/restore/engine_write/import, snapshot Yjs, markdown renderizado, frontmatter, hash, contribuyentes, autor), `id_counters` (`project_id`, `kind`, `last_seq`), `project_baselines`, `commits` y `project_code_state` (escritos por SDD-010).

- **Id al crear:** con una sola base la reserva es segura (reemplaza ADR-002 D12 en modo SaaS): `UPDATE id_counters ... RETURNING` con lock de fila, sembrado desde los ids existentes; nunca se reutilizan. Un SDD en borrador puede referenciar un PRD en borrador; los comentarios y URLs son estables.
- **Flujo:** `draft → in_review → published → archived`. Editor+ crea (desde `templateFor(kind)`), edita y pide revisión; **solo admin de proyecto publica**: la pantalla muestra el contenido congelado de la versión N, destaca los cambios de frontmatter (en especial `impacts_paths`), de `## Tareas` y los links o comandos agregados desde la última versión publicada (lo publicado llega al code assistant de los developers), y el request envía `versionId` + `content_hash`, que deben coincidir con la última versión. Publicar aplica `validateDocument` en fase `publish`, campos gestionados por el servidor (`id`, `type`, `status` `approved`/`active`, fechas), congela la versión y dispara la proyección; para SDD/ADR corre después `generateWorkOrders` idempotente con reintento visible en la UI. Editar lo publicado sigue en la copia de trabajo; los developers por MCP solo ven `published_raw` hasta republicar.
- **Archivar:** solo si ningún documento publicado lo enlaza; los archivados siguen en `scan` con su estado.
- **Reconocer drift:** admin de proyecto con confirmación y auditoría ejecuta `acknowledge` sobre un WO, blueprint o feature (reemplaza al `prdm sync ack` local).
- **Documentos generados** (WOs, feedback por MCP): `origin=generated`, de solo lectura en el editor; solo cambian por operaciones del engine, que crean versiones `engine_write`.
- **Cierre de feature:** admin de proyecto con confirmación explícita → `closureReadiness` + `closeFeature` (reemplaza ADR-002 D15 en modo SaaS).

## Tests

Equivalencia `scanContents` ≡ `scanDocuments` y del report; **suite de contrato** de `ProjectEngine` contra `Engine` (fixture de testkit) y `PgProjectEngine` (Postgres 5433 + Neo4j 7688) con claim, complete, generate, feedback con un borrador FB/FR/ART abierto, acknowledge y refresh; concurrencia de ids; test que cuenta llamadas a `writeSnapshot` por transacción (no tiempos); tests existentes de core, mcp, cli y web sin cambios y verdes.

## Tareas

- [ ] Corregir la carrera de withRepoLock en la que un heartbeat en vuelo reescribe el lock después de release y lo deja huérfano (deadlock hasta staleAfterMs), serializando y esperando los heartbeats antes de liberar, con test de regresión de adquisiciones secuenciales
- [ ] Extraer scanContents puro de scanDocuments y buildRefreshReport de Engine sin cambio de comportamiento, con tests de equivalencia
- [ ] Interfaz ProjectEngine con settings sin neo4j ni root, lastReport y scan, implementada por Engine y usada para tipar las funciones de dominio, con guardia de raíz absoluta en safe-fs
- [ ] EngineOps.readCommit y ProjectEngine.scan reemplazando la lectura directa de git y de config.root en workorders/lifecycle.ts, lifecycle/close.ts y mcp tools-authoring.ts, con tests
- [ ] PrdmDeps con engine ProjectEngine y authoring opcional, buildProjectSummary con ProjectEngine.scan y get_drift_report remoto sobre lastReport sin refresh, con tests
- [ ] loadProjectSettings separado de loadConfig para no exigir NEO4J_PASSWORD en modo remoto y assertLocalNeo4j exportado, con tests
- [ ] validateDocument puro en core para documentos con id real en fase edit y publish, con tests
- [ ] Subpath exports @prdm/core/domain seguro para navegador y @prdm/mcp/lib con fenceTag y escapeFenceChars sin ejecutar main al importar, alias de subpath en vitest.config.ts y guard tests
- [ ] Tablas documents, document_versions, id_counters, project_baselines, commits y project_code_state con FKs compuestas, RLS y migración
- [ ] Asignación de ids por proyecto con contador bajo lock de fila sembrado desde ids existentes y scan().ids que incluye borradores, con test de concurrencia sin repetidos
- [ ] PgProjectEngine con scan, escrituras de documentos y transacción con pg_advisory_xact_lock por proyecto, con tests
- [ ] Proyección al grafo con outbox graph_version y graph_dirty tras el commit, una sola writeSnapshot por transacción y re-proyección en recover, con test que cuenta proyecciones
- [ ] PgProjectEngine.refresh con estado de código verificado por CI, reconciliación por hash de impacts_paths con aviso awaiting_ci_report y baseline en Postgres, con tests
- [ ] Suite de contrato de ProjectEngine ejecutada contra Engine y PgProjectEngine con claim, complete, generate, feedback con borrador abierto, acknowledge y refresh
- [ ] Flujo de estados draft, in_review, published y archived con permisos y reglas de archivado, con tests
- [ ] Publicación de un version id con content_hash, validación bloqueante, campos gestionados por el servidor, versión congelada y proyección, con tests
- [ ] Generación idempotente de WOs al publicar SDD y ADR con reintento, con tests
- [ ] Escrituras del engine sobre campos editables de documentos con copia de trabajo aplicadas a la copia después del commit vía outbox idempotente como transacción de servidor atribuida, con tests de rollback
- [ ] Reconocimiento de drift desde el dashboard por admin de proyecto (WO, blueprint o feature) con confirmación y auditoría, con tests
- [ ] Lista de documentos por tipo y estado y alta desde templateFor en la app, con tests
- [ ] Vistas de grafo y drift publicados por proyecto con @prdm/ui en la app, con tests
- [ ] Cierre de feature con closureReadiness y confirmación del admin en la app, con tests
