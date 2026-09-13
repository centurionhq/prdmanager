---
id: SDD-002
type: SDD
title: "Motor headless multi-proyecto con autoría conversacional"
status: active
architects: ["PRD-002"]
governs: ["packages/core/src/**", "packages/cli/src/**", "packages/mcp/src/**"]
created_at: 2026-09-13
tags: ["architecture", "multi-project", "headless", "authoring", "mcp", "neo4j"]
---

## Contexto

PRD-002 evoluciona el motor de PRD-001 (un solo repositorio) a un motor de gobernanza **headless y multi-proyecto**. Los asistentes redactan documentos por MCP y el core valida esquemas, enlaces y ciclo de vida, asigna IDs sin colisiones y persiste de forma atómica en disco y Neo4j. Las decisiones con alternativas están en ADR-002.

## Stack Técnico

| Componente | Tecnología | Versión | Cambio |
|---|---|---|---|
| Monorepo | npm workspaces (npm 10.8.2) | — | Nuevo: `packages/core`, `packages/cli`, `packages/mcp`, `packages/testkit` |
| Build | TypeScript `tsc -b` con project references y `customConditions: ["@prdm/source"]` | 7.0.2 | Nuevo layout |
| Config de proyecto | yaml | 2.9.1 | Nueva dependencia (schema `core`, sin tags custom, sin alias) |
| Tests | vitest `test.projects` + @vitest/coverage-v8 | 4.1.11 | Proyectos por paquete |
| Base de grafos | Neo4j Community + APOC | 2026.08.1 | Migraciones versionadas y constraints compuestas |
| Resto | Node 20.20.2, tsx 4.23.13, neo4j-driver 6.2.0, @modelcontextprotocol/sdk 1.30.0, zod 4.6.3, gray-matter 4.0.3, fast-glob 3.3.3, commander 14.0.3, chokidar 5.0.0, dotenv 17.4.2 | — | Sin cambios |

## Arquitectura

### Paquetes

| Paquete | Responsabilidad | No puede importar |
|---|---|---|
| `@prdm/core` | Dominio, parser, grafo, sync, work orders, feedback, artifacts, métricas, proyecto, autoría, ciclo de vida, scaffolding, migraciones | `commander`, `chokidar`, `@modelcontextprotocol/*` |
| `@prdm/cli` | Binario `prdm` (commander) | — |
| `@prdm/mcp` | Binario `prdm-graph` (servidor MCP stdio) | — |
| `@prdm/testkit` | Helpers de tests (privado) | — |

### Proyecto activo

`.prdm.yaml` en la raíz del proyecto, descubierto subiendo desde el directorio actual (`PRDM_ROOT` lo fuerza). Define `project.id` (`prj_` + 16 hex), nombre, mapa de carpetas por tipo de documento, ignore, reglas de git, triaje, ciclo de vida y límites de autoría. Los secretos siguen en `.env`/entorno. Un subdirectorio con su propio `.prdm.yaml` es otro proyecto y se excluye del scan.

### Grafo multi-proyecto

- `Neo4jGraphDatabase` gestiona driver, verificación, migraciones y proyectos; `forProject(ctx)` devuelve un `GraphStore` ligado al proyecto, así ninguna consulta puede omitir el filtro.
- Todo `:Node`, `:CodeRef`, `:Commit` y `:Actor` tiene `project_id` y `[:BELONGS_TO]->(:Project)`; unicidad compuesta `(project_id, id|key|sha)`.
- Migraciones versionadas en `(:SchemaMigration {version, name, checksum, applied_at})`; la migración 2 elimina los datos derivados sin proyecto y `prdm sync` los reconstruye desde Markdown.
- Full-text `node_text_v2` indexa `project_id` y las búsquedas lo exigen en la query Lucene.
- Nueva relación `(:Feature)-[:JUSTIFIED_BY]->(:Feedback|:Artifact)`.

### Autoría conversacional

`AuthoringService` mantiene `DraftSession`s en memoria (TTL, máximo de borradores y de bytes). `validate` es puro: overlay del borrador sobre el scan, zod, enlaces dentro del proyecto (incluidos IDs reservados por otros borradores) y reglas de ciclo de vida. `commit` corre dentro de una transacción atómica del engine: re-scan bajo lock, renumeración si el ID fue tomado, escritura journaled (temp + fsync + link/rename), refresh y, ante cualquier error, restauración de archivos en orden inverso. El refresh escribe el snapshot en Neo4j **antes** de guardar el baseline.

### Ciclo de vida

Función pura `checkLifecycle(docs, ctx)` usada por `sync`, `validate_draft`, `generate_work_orders` y `prdm close`:

| Etapa | Regla |
|---|---|
| Ingesta | FB con `informs` o `root: true`; ART con `provides_context_for` o `root: true` |
| Definición | MRD con `justified_by` o `root: true`; PRD/FR con `justified_by` hacia FB/ART |
| Diseño | SDD/ADR con `impacts_paths` y `## Tareas` con al menos un checkbox |
| Planificación | WO solo desde el generador, nace `pending` |
| Ejecución | Commit que toca código gobernado exige `Refs: WO-NNN` válido del proyecto (hook `commit-msg` y `prdm check commits`) |
| Cierre | `prdm close <FEATURE> --ack --by dev:x`: feature aprobada, WOs de sus blueprints `done`, 0 errores de drift |

Los documentos previos a PRD-002 quedan exentos mediante `lifecycle.grandfathered` en `.prdm.yaml`.

### Cobertura compartida

Un WO terminado y vigente cubre un archivo para todos los blueprints que lo gobiernan, no solo para el que implementa. Sin esta regla, cualquier cambio de PRD-002 dejaría el código de SDD-001 fuera de sincronía para siempre.

### Superficie MCP nueva

`get_project`, `draft_artifact`, `validate_draft`, `commit_artifact`, `list_drafts`, `discard_draft`, `get_closure_readiness`; prompt `author_artifact` (directiva de Tech PM, reglas del tipo, template y confirmación del usuario antes de `commit_artifact`); recursos `prdm://project` y `prdm://templates/{kind}`.

## Seguridad

- Mapa de carpetas y rutas validados dentro de `docs_dir` y del repo (`safe-fs`).
- YAML con schema `core`, sin tags custom ni alias, claves únicas y límite de 64 KiB.
- Hooks escritos en bloques marcados; el ID y el nombre del proyecto nunca se interpolan sin comillas.
- Borradores acotados en cantidad, tamaño y tiempo; IDs de borrador aleatorios.
- `project_id`, IDs y labels siempre parametrizados en Cypher.
- Contenido de proyecto entregado a los asistentes delimitado como datos no confiables.

## Tareas

- [ ] Modelo multi-proyecto en Neo4j: nodo Project, BELONGS_TO, constraints compuestas, migraciones versionadas y store ligado al proyecto
- [ ] AuthoringService con DraftSession en memoria, reserva de IDs, validación en vivo y commit atómico journaled
- [ ] Comando prdm init con estructura de carpetas, .prdm.yaml, registro del proyecto, templates y hooks idempotentes
- [ ] Herramientas MCP de autoría draft_artifact, validate_draft y commit_artifact con el prompt conversacional author_artifact
- [ ] Monorepo con npm workspaces para @prdm/core, @prdm/cli y @prdm/mcp, y cobertura compartida entre blueprints
- [ ] Archivo .prdm.yaml con descubrimiento del proyecto activo y mapa de carpetas por tipo de documento
- [ ] Renombres impacts_paths y pending con alias legacy, content hash v2, baseline v2 y prdm migrate docs
- [ ] Máquina de estados del ciclo de vida con JUSTIFIED_BY y cierre con prdm close
- [ ] Enforcement de trailers Refs en commits de código gobernado con hook commit-msg, prdm check commits y CI
- [ ] Dogfooding end-to-end con aislamiento de dos proyectos y autoría conversacional hasta 0 drift
