# prdmanager — Motor de Grafo de Producto y Contexto

Implementación de [PRD-001](docs/prd/PRD-001-Graph-Engine-Enhanced.md), [PRD-002](docs/prd/PRD-002.md) y [PRD-003](docs/prd/PRD-003-parser-de-simbolos-con-tree-sitter-validado-de-pun.md) (los tres `closed`): un grafo de producto que une **Feature Tree** (MRD/PRD/FR), **Blueprints** (SDD/ADR), **Work Orders**, **Artifacts**, **Feedback** y **código**. Asistentes de IA lo usan vía MCP, y el grafo detecta cuándo la documentación y el código se desincronizan.

- **Doc-as-code:** los `.md` con frontmatter YAML son la fuente de verdad, versionada en git.
- **Neo4j local** es el índice vivo del grafo y se puede reconstruir siempre desde los documentos.
- **Autoría conversacional:** asistentes redactan por MCP, el motor valida y persiste de forma atómica.
- **Multi-proyecto:** varios proyectos en una sola instancia Neo4j, aislados por partición.

Arquitectura: [SDD-001](docs/sdd/SDD-001-graph-engine.md), [SDD-002](docs/sdd/SDD-002-multi-project-authoring.md), [SDD-003](docs/sdd/SDD-003-draft-persistence.md), [SDD-004](docs/sdd/SDD-004-tree-sitter-symbols.md) · Decisiones: [ADR-001](docs/adr/ADR-001-neo4j-local.md), [ADR-002](docs/adr/ADR-002-multi-project-isolation.md), [ADR-003](docs/adr/ADR-003-tree-sitter-wasm.md) · Mercado: [MRD-001](docs/mrd/MRD-001.md) · Modelo: [docs/model/graph-model.json](docs/model/graph-model.json)

## Stack

| Componente | Tecnología | Versión |
|---|---|---|
| Monorepo | npm workspaces | 10.8.2 |
| Build | TypeScript `tsc -b` + project references | 7.0.2 |
| Runtime | Node.js | 20.20.2 |
| Base de grafos | Neo4j Community + APOC en Docker (red interna, acceso local) | 2026.08.1 |
| Driver Neo4j | neo4j-driver | 6.2.0 |
| MCP | @modelcontextprotocol/sdk | 1.30.0 |
| Config | yaml | 2.9.1 |
| Validación | zod | 4.6.3 |
| Parsing | gray-matter, fast-glob | 4.0.3, 3.3.3 |
| Símbolos | web-tree-sitter (WASM, sin bindings nativos), tree-sitter-wasms | 0.25.10, 0.1.13 |
| CLI | commander, chokidar, dotenv | 14.0.3, 5.0.0, 17.4.2 |
| Herramientas | tsx | 4.23.13 |
| Tests | vitest + @vitest/coverage-v8 | 4.1.11 |

## Monorepo

Estructura de paquetes npm workspaces:

| Paquete | Responsabilidad | Binario / Entry |
|---|---|---|
| `@prdm/core` | Dominio, parser, grafo, autoría, ciclo de vida, scaffold | — |
| `@prdm/cli` | CLI principal `prdm` | `packages/cli/src/index.ts` |
| `@prdm/mcp` | Servidor MCP `prdm-graph` | `packages/mcp/src/server.ts` |
| `@prdm/testkit` | Helpers de tests (privado) | — |

Scripts raíz (`package.json`):
- `npm run build` — TypeScript incremental (`tsc -b`)
- `npm run typecheck` — Type check incluyendo tests
- `npm run prdm -- <cmd>` — CLI sin compilar (con `tsx`)
- `npm run mcp` — Servidor MCP sin compilar
- `npm run test` — Unit, integración y E2E
- `npm run coverage` — Tests + cobertura (umbral 80%)

Cada paquete tiene su propio `package.json`, `tsconfig.json` y tests en `tests/`.

## Inicio rápido

### Proyecto Nuevo

```bash
# 1. Secretos en .env (generador de contraseña)
cp .env.example .env
sed -i "s/^NEO4J_PASSWORD=.*/NEO4J_PASSWORD=$(openssl rand -hex 16)/" .env

# 2. Neo4j + proxy localhost (Browser en http://localhost:7474)
docker compose up -d

# 3. Instalar dependencias
npm ci

# 4. Inicializar el proyecto
npm run prdm -- init --name "mi-proyecto"

# 5. Migrar esquema y scan inicial
npm run prdm -- db migrate
npm run prdm -- index
```

### Proyecto Existente (Adopción)

Si ya existe un `prdm.config.json` (PRD-001):

```bash
cp .env.example .env
sed -i "s/^NEO4J_PASSWORD=.*/NEO4J_PASSWORD=$(openssl rand -hex 16)/" .env
docker compose up -d
npm ci

# Convierte prdm.config.json → .prdm.yaml y configura hooks
npm run prdm -- init --adopt --name "nombre-del-proyecto"

# Migra el esquema Neo4j (v2, destructiva para grafo derivado)
npm run prdm -- db migrate

# Reconstruye desde los documentos
npm run prdm -- sync
```

## Configuración de Proyecto: `.prdm.yaml`

Archivo YAML descubierto hacia arriba desde el directorio actual (búsqueda: `PRDM_ROOT`, luego subir hasta encontrar `.prdm.yaml` o la raíz de git). Generado por `prdm init`, nunca contiene secretos (estos van en `.env`).

### Esquema completo

| Clave | Tipo | Descripción | Default |
|---|---|---|---|
| `version` | int | Versión del schema | — |
| `project.id` | string | ID único (`prj_` + 16 hex) | Generado |
| `project.name` | string | Nombre del proyecto (printable, ≤100 chars) | — |
| `docs_dir` | string | Raíz de carpetas de documentos | `docs` |
| `folders.<TIPO>` | string | Ruta de carpeta para tipo `MRD/PRD/FR/SDD/ADR/WO/ART/FB` | Defaults estándar |
| `ignore` | string[] | Glob patterns a ignorar en scans | `[]` |
| `git.max_commits` | int | Límite de commits a analizar en la rama | `500` |
| `git.enforce_refs` | bool | Requerir `Refs: WO-xxx` en código gobernado | `true` |
| `git.enforce_refs_since` | string? | SHA de commit donde comienza a aplicarse (null = desde raíz) | `null` |
| `triage.auto_link_min_score` | float | Score mínimo Lucene para auto-enlace | `0.5` |
| `triage.auto_link_margin` | float | Margen entre 1.º y 2.º candidato | `1.05` |
| `triage.max_candidates` | int | Máximo de candidatos retornados | `5` |
| `triage.min_matched_terms` | int | Términos mínimos que coinciden | `2` |
| `lifecycle.grandfathered` | [{id, hash}] | Documentos pre-PRD-002 exentos | `[]` |
| `authoring.draft_ttl_minutes` | int | Minutos de retención de borradores en memoria (1–1440) | `60` |
| `authoring.max_drafts` | int | Máximo de borradores simultáneos por proyecto (1–200) | `20` |
| `authoring.max_draft_bytes` | int | Máximo de bytes por borrador (1 KiB–1 MiB) | `262144` |

Validaciones YAML (SDD-002 "Seguridad"):
- Schema `core` (YAML 1.2, sin tags personalizados, sin aliases)
- Máximo 64 KiB
- Claves únicas
- Ninguna clave contiene `neo4j`, `password`, o `secret` (case-insensitive)

### Carpetas estándar

```
docs/
  mrd/        # MRD (Market Requirements)
  prd/        # PRD (Product Requirements)
  fr/         # FR (Feature Request)
  sdd/        # SDD (System Design)
  adr/        # ADR (Architecture Decision)
  work-orders/# WO (Work Order)
  artifacts/  # ART (Artifact)
  feedback/   # FB (Feedback)
```

### Descubrimiento del Proyecto Activo

1. Variable `$PRDM_ROOT` fuerza la raíz explícitamente (debe contener `.prdm.yaml` o el legacy `prdm.config.json`)
2. Si no, sube desde `process.cwd()` directorio por directorio buscando `.prdm.yaml`, **sin detenerse en `.git`**: llega hasta la raíz del filesystem si hace falta, y devuelve el primer `.prdm.yaml` que encuentra
3. Si ningún ancestro tiene `.prdm.yaml`, cae al ancestro más cercano con el legacy `prdm.config.json`, y si tampoco hay ninguno, usa `process.cwd()` tal cual
4. Si hay subdirectorio con su propio `.prdm.yaml`, ese es un proyecto separado (excluido del scan, código gobernado y política de commits)

Ruta de proyecto (`project.root`): realpath del directorio que contiene `.prdm.yaml`.

## Modelo Multi-Proyecto

### Aislamiento

- **Nodo `(:Project)`** por proyecto, guardado en Neo4j: `{id, name, rootFingerprint, nodeCount}`
- **Partición por `project_id`:** todo `:Node`, `:CodeRef`, `:Commit`, `:Actor` tiene `project_id` y relación `[:BELONGS_TO]->(:Project)`
- **Unicidad compuesta:** constraints `(project_id, id)`, `(project_id, key)`, `(project_id, sha)` en Community 2026.08.1
- **Protección de raíz:** `.prdm.yaml` define un proyecto para una máquina (realpath único). Si se clona, fork o worktree crea otro checkout del mismo `project.id`, `writeSnapshot` y `db reset --yes` se niegan (nada se borra). Use `prdm project claim` para reasignar.

### Migraciones y Esquema

- **Versionadas:** cada migración es transacción auto-committed (necesario para `CALL … IN TRANSACTIONS`)
- **Guarda de esquema:** clientes verifican versión al abrir (excepto `db migrate`, `db status`)
- **Destructivas explícitas:** solo corren con `prdm db migrate`

Comandos: `db up`, `db migrate`, `db status`, `db reset --yes`, `db doctor`, `project list`, `project claim`, `project remove <id> --yes`

## Ciclo de Vida Determinista

El motor bloquea avances si no se cumplen invariantes en cada etapa. Máquina de estados:

| Etapa | Artefacto(s) | Invariante | Error sin |
|---|---|---|---|
| **1. Ingesta** | `FB` (Feedback), `ART` (Artifact) | FB: `informs` hacia feature O `root: true`; ART: `provides_context_for` hacia feature O `root: true` | issue `lifecycle_violation` |
| **2. Definición** | `MRD`, `PRD`, `FR` | Validación Zod + al menos una relación `[:JUSTIFIED_BY]` hacia FB/ART | issue `lifecycle_violation` |
| **3. Diseño** | `SDD`, `ADR` | `impacts_paths` no vacío + sección `## Tareas` con al menos un checkbox | issue `lifecycle_violation` |
| **4. Planificación** | `WO` (Work Order) | Solo se generan con `prdm wo generate <SDD-ID>`, siempre nace `pending` | — |
| **5. Ejecución** | Commits de código | Commit que toca código gobernado exige trailer `Refs: WO-xxx` hacia WO `pending`/`in_progress`/`out_of_sync` de este proyecto cuyo blueprint cubre al menos un path tocado | hook `commit-msg` rechaza el commit |
| **6. Cierre** | Feature + Blueprints | `prdm close <FEATURE> --ack --by <actor>`: todos los blueprints implementados (`done`), 0 drift en el proyecto, firma del arquitecto | `prdm close`/`closure-readiness` listan los checks pendientes |

Todo issue de ciclo de vida (etapas 1-3) usa el mismo `kind: lifecycle_violation`; no hay códigos por regla individual.

### Herencia (Grandfathering)

Documentos previos a PRD-002 que no cumplen las reglas quedan exentos listando `{id, hash}` en `lifecycle.grandfathered`. La exención se pierde si el contenido cambia. CI rechaza que la lista crezca respecto de la rama base.

```yaml
lifecycle:
  grandfathered:
    - id: MRD-001
      hash: 800d537825a349946beb692ade513646d737e911542cbdaceb439f0d0232283c
```

## Política de Commits (Refs)

### Git Hook `commit-msg`

Inyectado por `prdm init`/`prdm hooks install` en el directorio que devuelve `git rev-parse --git-path hooks` (honra `core.hooksPath`, worktrees y husky; no depende de ninguna variable de entorno propia). Valida el trailer `Refs: WO-xxx`:

- Solo se aplica a commits que tocan **código gobernado** (archivos listados en `impacts_paths` de blueprints activos)
- Trailer requerido: `Refs: WO-NNN` (donde WO está en estado `pending`, `in_progress` o `out_of_sync`)
- WO debe tener un blueprint cuyo `impacts_paths` cubre al menos uno de los archivos tocados
- Bypass: `PRDM_SKIP_HOOKS=1 git commit` (desactiva hooks para un commit puntual)

### Validación en CI

```bash
# Validar un mensaje de commit (usado por el hook)
npm run prdm -- check commit-msg <archivo-mensaje>

# Validar todos los commits en un rango (para CI/PR)
npm run prdm -- check commits --range origin/main..HEAD
```

Cumple la política de commits sin requerir Neo4j. Basado en:
- Diff del commit (incluyendo borrados, `--no-renames`)
- `governs`/`impacts_paths` en HEAD e índice
- `enforce_refs` y `enforce_refs_since` del proyecto
- Grandfathered: lista de exenciones

## Autoría Conversacional (Headless)

Flujo de redacción de documentos por MCP:

1. **Asistente → `draft_artifact`:** comienza un borrador con tipo, título y contenido
2. **Motor → validación:** Zod schema, enlaces a otros documentos, reglas de ciclo de vida
3. **Asistente iteración:** `list_drafts` → editar contenido → `validate_draft` hasta pasar
4. **Usuario confirma:** antes de comprometer
5. **`commit_artifact`:** asigna ID definitivo, escribe en disco, actualiza Neo4j (transacción atómica)

### Herramientas MCP

Servidor `prdm-graph` (bin: `packages/mcp/src/server.ts`):

| Herramienta | Entrada | Salida |
|---|---|---|
| `get_project` | — | Nombre, ID, paths de carpetas del proyecto activo |
| `draft_artifact` | `kind` (MRD/PRD/FR/SDD/ADR/WO/ART/FB), `title`, `body` (Markdown) | `draftId` (`KIND-?`), validación preliminar |
| `validate_draft` | `draftId`, `body` (Markdown actualizado) | Errores (vacío = válido) |
| `commit_artifact` | `draftId`, confirmación del usuario | `documentId` (ID final), documento completo con frontmatter |
| `list_drafts` | — | Lista de borradores activos (ID, tipo, título, edad) |
| `discard_draft` | `draftId` | — |
| `get_closure_readiness` | `featureId` | Checks: feature exists, approved, blueprints have WOs, all WOs done, 0 errors en proyecto (read-only) |

También expone lectura (`get_node`, `search_nodes`, `get_feature_branch`, `get_feature_tree`, `list_work_orders`, `get_work_order_context`, `triage_feedback`, `get_metrics`), escritura (`generate_work_orders`, `claim_work_order`, `complete_work_order`, `submit_feedback`, `create_feature_request`, `attach_artifact`) y drift (`get_drift_report`, `acknowledge_sync`, `refresh_index`). `acknowledge_sync` por MCP **solo acepta ids de Work Order** (`WO-xxx`); reconocer un Blueprint, Feature o `"all"` es exclusivo de la CLI (`prdm sync ack`, gate de arquitecto igual que `prdm close`).

### System Prompt `author_artifact`

Directiva para el asistente:

- **Rol:** Tech PM generando documentos de producto/diseño
- **Template por tipo:** cada tipo tiene un template Markdown con secciones, ejemplos y campos obligatorios
- **Validación durante iteración:** el asistente ve errores en vivo y ajusta
- **Confirmación:** antes del commit, muestra el documento final y pide `--ack`

### Borradores en Memoria

- Almacenados en el proceso MCP actual, no en disco
- TTL configurable: `authoring.draft_ttl_minutes` (default 60 min)
- Máximos: `authoring.max_drafts` (default 20), `authoring.max_draft_bytes` (default 256 KiB)
- ID provisional (`KIND-?`), ID definitivo asignado al commit bajo lock del repositorio
- Si el servidor MCP se reinicia, borradores se pierden (el usuario vuelve a empezar o importa desde histórico)

### Transacción Atómica

Commit de artefacto:

1. **Lock con dueño:** `.prdm/engine.lock` {token, pid, heartbeat}, liberado solo por el proceso dueño
2. **Journal por transacción:** `.prdm/journal-<token>.json` registra contenido original antes de cada escritura
3. **Orden:** escritura de estado → `writeSnapshot` → `saveBaseline`
4. **Rollback:** si falla la mutación Neo4j, journal se aplica en orden inverso, archivos se restauran y se marca `.prdm/graph-stale`
5. **Recuperación:** todo comando CLI que abre contexto (excepto `db migrate`/`db status`/`db doctor`) y toda herramienta/recurso/prompt de lectura del servidor MCP llaman `engine.recover()` antes de leer: reproducen cualquier journal huérfano y, si existe `.prdm/graph-stale`, fuerzan un refresh desde disco antes de servir datos

## Modelo de Documentos

| Tipo | Label Neo4j | Frontmatter → Relación |
|---|---|---|
| `MRD`, `PRD`, `FR` | `:Feature` | `implements`, `evolves_from` → `EVOLVES_FROM`; `justified_by`, inlinks `informs`/`provides_context_for` → `JUSTIFIED_BY` |
| `SDD`, `ADR` | `:Blueprint` | `architects` → `ARCHITECTS`; `impacts_paths` → `(:CodeRef)-[:GOVERNED_BY]->` |
| `WO` | `:WorkOrder` | `implements` → `IMPLEMENTS`; `assigned_to: agent:x` → `ASSIGNED_TO` |
| `ART` | `:Artifact` | `provides_context_for` → `PROVIDES_CONTEXT_FOR`; `inlinks` (invert) |
| `FB` | `:Feedback` | `informs` → `INFORMS` |
| Commit | `:Commit` | `Refs: WO-012` → `RESOLVES` |

**Hash de contenido (PRD-001, compatible PRD-002):**
- Campo `governs` (SDD-002 lo renombra a `impacts_paths`) hashea con su clave antigua
- Sección `## Tareas` excluida del hash de blueprints
- Campos nuevos (`justified_by`, `root`, `closed_at`, `closed_by`) sin default o volátiles, no alteran hashes

## CLI (Completa)

Ejecutar: `npm run prdm -- <cmd>` o tras build: `node packages/cli/dist/index.js <cmd>`.

**Proyecto:** `init [dir] --name <n> [--adopt] [--no-hooks] [--mcp] [--force]`, `hooks install [--force]`, `project list`, `project claim`, `project remove <id> --yes`

**BD:** `db up`, `db migrate`, `db status`, `db reset --yes`, `db doctor`

**Índice:** `index`, `lint`

**Feature Tree:** `tree [ID] --format text|json|mermaid`, `node <ID>`, `search <texto> [--label ...]`

**Drift:** `sync [--check] [--json]`, `sync ack <ID|all>`, `watch [--debounce <ms>]`

**Work Orders:** `wo generate <SDD-ID>`, `wo list [--status ...] [--blueprint ID]`, `wo context <WO-ID>`, `wo claim <WO-ID> --as <actor>`, `wo complete <WO-ID> --commit <sha>`

**Feedback:** `feedback add --text ... --source <fuente>` (`--file` alt), `feedback triage --text ...`, `fr create --title ... --parent <ID> [--from-feedback <FB-ID>]`

**Artefactos:** `ingest artifact <file> --source <meeting|email|slack|call|doc|other> [--title ...] [--link ID ...]`

**Cierre:** `close <FEATURE-ID> --ack --by <actor>`, `closure-readiness <FEATURE-ID> [--json]`

**Política:** `check commit-msg <file>`, `check commits --range <a..b>`

**Otras:** `migrate docs [--dry-run]`, `metrics [--json]`

## Migraciones desde PRD-001

**Migración v2 de esquema** (destructiva, ejecuta con `prdm db migrate`):
- Introduce nodo `(:Project)` y constraints compuestas `(project_id, id)`, etc.
- Borra nodos Node/CodeRef/Commit/Actor sin `project_id` (grafo derivado de PRD-001)
- Necesita `prdm sync` para reconstruir

**Campos renombrados** (requiere Neo4j para refresh final):
```bash
npm run prdm -- migrate docs     # Renombra governs→impacts_paths, todo→pending
```
- Hash mantiene clave antigua `governs` para compatibilidad
- Recalcula blueprints excluyendo sección `## Tareas`
- Re-baselinea si coincide bajo las nuevas reglas

### Grandfathering

Documentos con campos incompatibles quedan exentos agregándolos a `.prdm.yaml`:
```yaml
lifecycle:
  grandfathered:
    - id: MRD-001
      hash: 800d537...
```

Si el contenido cambia (hash distinto), la exención se pierde. CI rechaza que la lista crezca.

## Servidores MCP (`.mcp.json`)

| Servidor | Uso | Nota |
|---|---|---|
| `prdm-graph` | **Autoría y contexto.** Herramientas MCP y prompts de Tech PM. Levanta con `npm run mcp` | Nativo, en este monorepo |
| `neo4j` | MCP oficial Neo4j v1.6.0 (`get-schema`, `read-cypher`). Script: `scripts/mcp-neo4j.sh` | Modo lectura forzada |
| `neo4j-data-modeling` | Validación y export de modelo de grafo. Via `uvx` (mcp-neo4j-data-modeling@0.8.2) | Opcional |

`prdm init --mcp` fusiona en `.mcp.json` del proyecto destino la entrada `"prdm-graph": { "type": "stdio", "command": "npx", "args": ["--no-install", "prdm-graph"] }` (idempotente; conserva otros servidores ya declarados).

Cuando levantes Claude Code/MCP Client, pide aprobar servidores la primera vez. `claude mcp list` muestra estado.

## Skills (Claude Code)

Plugin **`neo4j-skills@neo4j-skills-marketplace`** v1.0.1 (declarado en `.claude/settings.json`):
- Skills Cypher 25, modelado Neo4j, driver JS v6
- Configuración con `/plugin configure neo4j-skills@neo4j-skills-marketplace` (la contraseña es sensible)

## Tests

```bash
# Instancia test efímera (127.0.0.1:7688)
docker compose --profile test up -d neo4j-test

# Tests: unit + integración + E2E MCP
npm test

# Cobertura (umbral 80%)
npm run coverage
```

Los tests de integración nunca usan BD de desarrollo (helper lo rechaza si la URI coincide).

## Seguridad

- **Filesystem:** `packages/core/src/util/safe-fs.ts` valida realpath, rechaza symlinks que salen del repo, abre con `O_NOFOLLOW`, limita tipo y tamaño
- **Neo4j:** Cypher siempre parametrizado; allowlist de APOC (`apoc.path.*`, `apoc.coll.*`, `apoc.meta.*`, `apoc.version`); contenedor sin internet (`LOAD CSV` blindada)
- **MCP:** inputs validados con zod; errores sin stack traces; contenido de artefactos/feedback delimitado como no confiable; `commit_artifact` es destructivo
- **Concurrencia:** lock `.prdm/engine.lock` entre CLI, hook, `watch` y MCP
- **Config:** YAML schema `core`, sin tags, sin alias, sin secretos (aquellos van en `.env`/entorno)
- **Commits:** hook de `commit-msg` bloquea si falta `Refs: WO-xxx` en código gobernado; bypass con `PRDM_SKIP_HOOKS=1`

## Variables de Entorno

Lectura desde `.env` (no versionado):

```bash
NEO4J_URI=neo4j://127.0.0.1:7687
NEO4J_DATABASE=neo4j
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=<generado>
PRDM_ROOT=<opcional; fuerza la raíz del proyecto>
PRDM_SKIP_HOOKS=1           # Desactiva hooks de git (commit puntual)
PRDM_ACTOR=agent:claude     # Actor por default para cierre
PRDM_BIN=<opcional; sobrescribe detección de binario prdm en hooks>
```

El binario CLI busca `.env` en el directorio del proyecto descubierto.

## Limitaciones Conocidas

- **Borradores:** persisten en `.prdm/drafts/` (FR-001/SDD-003) y se recuperan si el servidor MCP se reinicia; editar el mismo borrador desde dos procesos a la vez no tiene lock (última escritura gana)
- **Refresh completo:** cada commit trae un re-scan del proyecto completo (repositorios pequeños, sin impacto observable)
- **Gate de cierre:** por proyecto (no por feature): mientras un proyecto tenga drift, ninguna feature de él puede cerrarse
- **Full-text:** triaje sin normalizar scores Lucene; ajustar `triage.auto_link_min_score`/`auto_link_margin` en `.prdm.yaml` según el corpus crezca
- **Analizador fulltext:** `node_text_v2` no fija `analyzer` en `CREATE FULLTEXT INDEX` (sin cláusula `OPTIONS`); usa el default de Neo4j (`standard-no-stop-words` en 2026.08.1), verificado por `graph-model.test.ts` contra `docs/model/graph-model.json`, no una configuración explícita del proyecto
- **Extracción de símbolos:** Tree-sitter real (SDD-004) para TypeScript/TSX/JavaScript/Python, con la heurística previa como fallback para otras extensiones; un parseo o query adversarial se acota a 500 ms y se reporta como símbolo no encontrado en vez de bloquear `prdm sync`

## Fuera del MVP

- UI web (Neo4j Browser, Mermaid y MCP cubren necesidades actuales)
- GitHub App / webhooks (cubierto por CI con `sync --check`)
- Conectores directos a Slack/email (ingesta por archivo o MCP)
- Embeddings / vector index
- Multi-usuario / auth
- Neo4j Enterprise / Aura
