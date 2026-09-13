---
id: SDD-002
type: SDD
title: "Motor headless multi-proyecto con autoría conversacional"
status: active
architects: ["PRD-002"]
impacts_paths: ["packages/core/src/**", "packages/cli/src/**", "packages/mcp/src/**", "packages/testkit/src/**", "package.json", "packages/*/package.json", "tsconfig*.json", "packages/*/tsconfig*.json", "vitest.config.ts", ".github/workflows/prdm-sync.yml"]
created_at: 2026-09-13
tags: ["architecture", "multi-project", "headless", "authoring", "mcp", "neo4j"]
---

## Contexto

PRD-002 evoluciona el motor de PRD-001 (un solo repositorio) a un motor de gobernanza **headless y multi-proyecto**. Los asistentes redactan documentos por MCP y el core valida esquemas, enlaces y ciclo de vida, asigna IDs sin colisiones y persiste de forma atómica en disco y Neo4j. Las decisiones con alternativas están en ADR-002. Este diseño incorpora la revisión de arquitectura y de base de datos del 2026-09-13.

## Stack Técnico

| Componente | Tecnología | Versión | Cambio |
|---|---|---|---|
| Monorepo | npm workspaces (npm 10.8.2) | — | Nuevo: `packages/core`, `packages/cli`, `packages/mcp`, `packages/testkit` |
| Build | TypeScript `tsc -b` con project references | 7.0.2 | Nuevo layout |
| Config de proyecto | yaml | 2.9.1 | Nueva dependencia (schema `core`, sin tags custom, sin alias, claves únicas, 64 KiB) |
| Tests | vitest + @vitest/coverage-v8 | 4.1.11 | Configuración por paquete |
| Base de grafos | Neo4j Community + APOC | 2026.08.1 | Migraciones versionadas y constraints compuestas |
| Resto | Node 20.20.2, tsx 4.23.13, neo4j-driver 6.2.0, @modelcontextprotocol/sdk 1.30.0, zod 4.6.3, gray-matter 4.0.3, fast-glob 3.3.3, commander 14.0.3, chokidar 5.0.0, dotenv 17.4.2 | — | Sin cambios |

## Arquitectura

### Paquetes

| Paquete | Responsabilidad | No puede importar |
|---|---|---|
| `@prdm/core` | Dominio, parser, grafo, sync, work orders, feedback, artifacts, métricas, proyecto, autoría, ciclo de vida, scaffolding | `commander`, `chokidar`, `@modelcontextprotocol/*` |
| `@prdm/cli` | Binario `prdm` (commander) | — |
| `@prdm/mcp` | Binario `prdm-graph` (servidor MCP stdio) | — |
| `@prdm/testkit` | Helpers de tests (privado) | — |

### Proyecto activo

`.prdm.yaml` en la raíz del proyecto, descubierto subiendo desde el directorio actual (`PRDM_ROOT` lo fuerza), generado por `prdm init` (este repositorio se adopta con `prdm init --adopt`, que convierte `prdm.config.json`). Define `project.id` (`prj_` + 16 hex), nombre, mapa de carpetas por tipo de documento, ignore, reglas de git, triaje, ciclo de vida y límites de autoría. Los secretos siguen en `.env`/entorno. Un subdirectorio con su propio `.prdm.yaml` es otro proyecto y se excluye del scan, del código gobernado y de la política de commits.

`(:Project)` guarda la **huella de la raíz** (realpath del directorio del proyecto en esa máquina). `writeSnapshot` se niega a escribir si la huella no coincide, así un clon, fork o worktree con el mismo `project.id` no borra la partición de otro checkout; `prdm project claim` reasigna la huella de forma explícita (por ejemplo, tras mover el repositorio).

### Grafo multi-proyecto

- `Neo4jGraphDatabase` gestiona driver, verificación, migraciones y proyectos; `forProject(ctx)` devuelve un `GraphStore` ligado al proyecto, así ninguna consulta puede omitir el filtro. El `project_id` se valida contra `^prj_[0-9a-f]{16}$` antes de usarse.
- Todo `:Node`, `:CodeRef`, `:Commit` y `:Actor` tiene `project_id` y `[:BELONGS_TO]->(:Project)`; unicidad compuesta `(project_id, id|key|sha)` (verificado en Community 2026.08.1: crea índice compuesto usado por `MERGE`).
- Deletes del snapshot filtran `project_id` en **todos** los nodos matcheados, incluidos ambos extremos de cada relación.
- Migraciones versionadas: cada statement corre en auto-commit (requisito de `CALL … IN TRANSACTIONS`); `(:SchemaMigration {version, name, checksum, applied_at})` se escribe al final, después de `db.awaitIndexes`, y una versión aplicada con checksum distinto es un error.
- **Guarda de esquema:** las migraciones destructivas solo corren con `prdm db migrate` explícito; CLI y servidor MCP verifican la versión de esquema al abrir y se niegan a operar sobre una versión desconocida o anterior (el servidor MCP ya no migra al arrancar).
- Full-text `node_text_v2` indexa `project_id`; el analizador `standard-no-stop-words` lo trata como un único token y la query exige `+project_id:"prj_…"`.
- `(:Feature)-[:JUSTIFIED_BY]->(:Feedback|:Artifact)` se deriva de los enlaces inversos `INFORMS` y `PROVIDES_CONTEXT_FOR`, más el campo opcional `justified_by` de la feature.

### Hash de contenido

Se mantiene el algoritmo de PRD-001 con dos ajustes compatibles: `impacts_paths` se hashea bajo la clave histórica `governs`, y los campos nuevos (`justified_by`, `root`, `closed_at`, `closed_by`) son opcionales sin default o volátiles, por lo que no alteran hashes existentes. La sección `## Tareas` se excluye del hash de los blueprints: agregar o marcar tareas no invalida WOs terminados. `prdm migrate docs` re-baselinea solo los blueprints sincronizados (si el hash con tareas coincide con el baseline, registra el hash sin tareas; ídem `blueprint_hashes` de los WOs) y renombra `governs`→`impacts_paths` y `todo`→`pending` en los documentos.

### Autoría conversacional

`AuthoringService` mantiene `DraftSession`s en memoria (TTL, máximo de borradores y de bytes). Un borrador nuevo muestra su ID como `KIND-?`: el ID definitivo se asigna al hacer commit, bajo el lock del repositorio y tras un re-scan, así no hay reservas que otros procesos no ven. `validate` es puro (overlay del borrador sobre el scan, zod, enlaces dentro del proyecto y reglas de ciclo de vida); un enlace a otro borrador sin commitear es `draft_dependency` y bloquea el commit. `commit` es idempotente por borrador: el resultado queda como tombstone durante el TTL y un reintento lo devuelve sin duplicar.

### Transacción atómica

- **Lock con dueño:** `.prdm/engine.lock` guarda token, pid y heartbeat; solo se considera abandonado si el proceso dueño está muerto o el heartbeat venció, y solo el dueño lo libera.
- **Journal por transacción:** `.prdm/journal-<token>.json` registra el contenido original (o "creado") antes de cada escritura; creación con temp + fsync + `link()`, reemplazo con temp + fsync + `rename`, y fsync del directorio padre.
- **Orden del refresh:** escrituras de estado → `writeSnapshot` → `saveBaseline`.
- **Fallo:** el journal se aplica **solo como rollback** (restaura archivos en orden inverso) y deja el marcador `.prdm/graph-stale`; mientras exista, lecturas y `sync --check` fuerzan un refresh desde disco antes de responder. Journals de procesos muertos se aplican al abrir el engine, incluidos comandos de lectura y hooks.

### Ciclo de vida

Función pura `checkLifecycle(docs, ctx)` usada por `sync`, `validate_draft`, `generate_work_orders` y `prdm close`:

| Etapa | Regla |
|---|---|
| Ingesta | FB con `informs` o `root: true` (warning mientras `status: new`); ART con `provides_context_for` o `root: true` |
| Definición | MRD, PRD y FR con al menos un `JUSTIFIED_BY` hacia FB/ART |
| Diseño | SDD/ADR con `impacts_paths` y `## Tareas` con al menos un checkbox |
| Planificación | WO solo desde el generador, siempre nace `pending` |
| Ejecución | Commit que toca código gobernado exige `Refs: WO-NNN` de un WO del proyecto en estado `pending`, `in_progress` u `out_of_sync` cuyo blueprint gobierna al menos uno de los paths tocados |
| Cierre | `prdm close <FEATURE> --ack --by dev:x`: feature aprobada, WOs de sus blueprints `done`, 0 errores de drift en el proyecto |

Los documentos previos a PRD-002 que no cumplen las reglas quedan exentos mediante `lifecycle.grandfathered: [{id, hash}]`; la exención se pierde si el contenido cambia y CI falla si la lista crece respecto de la rama base.

**Política de commits** (hook `commit-msg` y `prdm check commits --range`, sin Neo4j): diff con `--no-renames` incluyendo borrados; commit raíz contra el árbol vacío; `--amend` evalúa el diff completo contra el padre; merges con resolución de conflictos en código gobernado también requieren `Refs`; los paths gobernados son la unión de `impacts_paths` en HEAD y en el índice; en CI, `enforce_refs`, `enforce_refs_since` (por ancestría) y `grandfathered` se leen de la rama base, y un push con `before` en ceros evalúa `origin/<default>..sha`.

### Cobertura compartida

Un WO terminado y vigente cubre un archivo para todos los blueprints que lo gobiernan, pero **solo** para cambios de código (`code_changed`) y archivos faltantes (`missing`). Nunca resuelve `blueprint_changed` ni `feature_changed` de otro blueprint: un diseño modificado solo se cubre con WOs que lo implementan.

### Superficie MCP nueva

`get_project`, `draft_artifact`, `validate_draft`, `commit_artifact`, `list_drafts`, `discard_draft`, `get_closure_readiness`; prompt `author_artifact` (directiva de Tech PM, reglas del tipo, template y confirmación del usuario antes de `commit_artifact`); recursos `prdm://project` y `prdm://templates/{kind}`.

### Criterio de éxito

PRD-002 §5 se valida con la siguiente iteración técnica (PRD-003, reemplazo del parser por Tree-sitter) realizada de punta a punta en un proyecto creado con `prdm init`. Hasta entonces PRD-002 permanece `approved`: completar WO-012..022 con 0 drift habilita, pero no reemplaza, esa prueba.

## Seguridad

- Mapa de carpetas y rutas validados dentro de `docs_dir` y del repo (`safe-fs`).
- YAML con schema `core`, sin tags custom ni alias, claves únicas y límite de 64 KiB.
- Hooks escritos en bloques marcados; el ID y el nombre del proyecto nunca se interpolan sin comillas; `PRDM_SKIP_HOOKS=1` los desactiva.
- Borradores acotados en cantidad, tamaño y tiempo; IDs de borrador aleatorios.
- `project_id`, IDs y labels siempre parametrizados en Cypher; `project_id` validado por allowlist antes de entrar en la query Lucene.
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
- [ ] Endurecer la transacción atómica tras la revisión: journal autenticado y acotado a documentos, lock con exclusión mutua real, rollback que no borra archivos ajenos y borradores sin pisar ediciones concurrentes
- [ ] Endurecer la política de Refs tras la revisión: bypasses en CI, proyectos en subdirectorios, hooks relativos al worktree, errores de git y lista de exentos por id y hash
- [ ] Corregir tras la revisión el reset sin huella, las lecturas sobre un grafo pendiente de recuperación, los fences de prompts, los acks de diseño por MCP y la documentación
- [ ] Evaluar la política de Refs en rangos históricos con el estado de cada WO al momento del commit, sin enforcement cuando la base no tiene .prdm.yaml y eximiendo solo la historia hasta enforce_refs_since
- [ ] Ajustar CI para que el checker de la base solo corra cuando la base ya adoptó prdm y su checkout no contamine sync --check
