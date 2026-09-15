# prdmanager — Motor de Grafo de Producto y Contexto

Implementación de [PRD-001](docs/prd/PRD-001-Graph-Engine-Enhanced.md), [PRD-002](docs/prd/PRD-002.md), [PRD-003](docs/prd/PRD-003-parser-de-simbolos-con-tree-sitter-validado-de-pun.md) y [PRD-004](docs/prd/PRD-004-explorador-web-del-feature-tree-y-drift.md) (los cuatro `closed`): un grafo de producto que une **Feature Tree** (MRD/PRD/FR), **Blueprints** (SDD/ADR), **Work Orders**, **Artifacts**, **Feedback** y **código**. Asistentes de IA lo usan vía MCP, un explorador web de solo lectura lo visualiza, y el grafo detecta cuándo la documentación y el código se desincronizan.

- **Doc-as-code:** los `.md` con frontmatter YAML son la fuente de verdad, versionada en git.
- **Neo4j local** es el índice vivo del grafo y se puede reconstruir siempre desde los documentos.
- **Autoría conversacional:** asistentes redactan por MCP, el motor valida y persiste de forma atómica.
- **Multi-proyecto:** varios proyectos en una sola instancia Neo4j, aislados por partición.

Arquitectura: [SDD-001](docs/sdd/SDD-001-graph-engine.md), [SDD-002](docs/sdd/SDD-002-multi-project-authoring.md), [SDD-003](docs/sdd/SDD-003-draft-persistence.md), [SDD-004](docs/sdd/SDD-004-tree-sitter-symbols.md), [SDD-005](docs/sdd/SDD-005-explorador-web.md) · Decisiones: [ADR-001](docs/adr/ADR-001-neo4j-local.md), [ADR-002](docs/adr/ADR-002-multi-project-isolation.md), [ADR-003](docs/adr/ADR-003-tree-sitter-wasm.md), [ADR-004](docs/adr/ADR-004-stack-del-explorador-web.md) · Mercado: [MRD-001](docs/mrd/MRD-001.md) · Modelo: [docs/model/graph-model.json](docs/model/graph-model.json)

## Stack

| Componente | Tecnología | Versión |
|---|---|---|
| Monorepo | npm workspaces | 11.19.0 |
| Build | TypeScript `tsc -b` + project references | 7.0.2 |
| Runtime | Node.js | 24.21.0 |
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
| `@prdm/web` | Explorador web de solo lectura (PRD-004) | `packages/web/src/server.ts` |
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

### Requisitos

- **Node 24** (LTS "Krypton", vigente hasta 2028-04), instalado a nivel usuario con [nvm](https://github.com/nvm-sh/nvm) — nunca con `sudo`. El repo fija la versión exacta en [`.nvmrc`](.nvmrc); parado en la raíz del repo, `nvm install` la lee e instala/activa automáticamente. Ver [ADR-005](docs/adr/ADR-005-node-24-lts.md): supera la restricción de Node 20 de [ADR-004](docs/adr/ADR-004-stack-del-explorador-web.md), cuyas demás decisiones (Vite, Fastify, React, jsdom, etc.) siguen vigentes.
- Docker (para Neo4j local).

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

## Web UI (`@prdm/web`, PRD-004)

Explorador **de solo lectura** del Feature Tree y del drift: canvas interactivo con Cytoscape.js, árbol navegable por teclado (alternativa accesible al canvas), búsqueda full-text, panel de detalle con relaciones, lista de Work Orders y banner de estado de sincronización. Backend Fastify que envuelve 1:1 `GraphStore`/`Engine.inspect()` (nunca escribe), ligado a `127.0.0.1`.

| Componente | Tecnología | Versión |
|---|---|---|
| Backend | Fastify + @fastify/static | 5.12.4, 10.1.3 |
| Frontend | Vite + React | 8.3.0, 19.3.0 |
| Grafo | cytoscape.js | 3.34.3 |
| E2E | @playwright/test | 1.63.0 |

```bash
# Producción / dogfooding: un solo proceso sirve API + bundle
npm run build && npm run build --workspace=@prdm/web
npm run web                                  # http://127.0.0.1:4600

# Iteración visual: dos procesos, HMR en el frontend
npm run web:api                              # Fastify vía tsx, sin build
npm run dev --workspace=@prdm/web            # Vite en http://localhost:5173, proxy de /api

# E2E contra servidor real + Neo4j de test (local, no en CI — ver Tests)
npm run test:e2e --workspace=@prdm/web
```

`PRDM_WEB_PORT` (por defecto `4600`) y `PRDM_WEB_HOST` (por defecto `127.0.0.1`; un valor no-loopback requiere `PRDM_WEB_ALLOW_REMOTE=1`) — ver Variables de Entorno.

## SaaS local (`@prdm/server` + `@prdm/app`, PRD-005)

`npm run dev` en la raíz levanta el servidor Fastify (`tsx watch`, con recarga en cada cambio) y Vite (proxy de `/api`, `/collab` y `/mcp` a `PRDM_SERVER_PORT`) como procesos hermanos, vía `packages/server/scripts/dev.mjs` — un script Node sin dependencias (SDD-006 "Local y despliegue"): no hacen falta dos terminales. Un solo `Ctrl-C` detiene ambos procesos; si alguno muere solo, el otro se detiene también con código de salida distinto de cero.

```bash
npm run dev                                  # servidor + app en paralelo, un solo Ctrl-C los detiene
```

Requiere `docker compose up -d postgres mailpit` y las variables de `.env` (`PRDM_PUBLIC_URL`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, etc. — ver Variables de Entorno) ya exportadas en el entorno.

En un Postgres nuevo (o tras cada migración agregada), aplicá el esquema una sola vez antes del primer `npm run dev` — el servidor no migra por sí solo, solo los harnesses de test lo hacen automáticamente:

```bash
npm run db:migrate                           # drizzle-kit migrate contra DATABASE_MIGRATION_URL
```

## SaaS multi-organización: MCP remoto y sync verificado por CI (SDD-010)

Para organizaciones que corren prdm como SaaS multi-tenant, los developers trabajan con repositorios **vinculados en remoto**: la documentación y la política de `Refs:` viven en el servidor, no en el repo. La CLI reenvía al code assistant vía un proxy MCP local, y el workflow de CI acredita el estado del código con un token OIDC de GitHub Actions firmado, sin guardar secretos de larga vida accesibles desde cualquier rama.

### Login y vinculación

Primero, autenticate contra tu servidor prdm con tu token personal:

```bash
prdm login --server https://tu-org.prdm.example
# Pide el token por prompt oculto; lo guarda en $XDG_CONFIG_HOME/prdm/credentials.json (modo 0600)
```

Después vinculá el repo a un proyecto remoto:

```bash
prdm link acme/widgets --server https://tu-org.prdm.example --mcp
# Escribe version: 2 en .prdm.yaml con la sección remote (server/org/project)
# Graba localmente (nunca en el repo) el graphProjectId vinculado, para detectar un .prdm.yaml editado
# Agrega la entrada stdio de prdm mcp-proxy a .mcp.json
```

Tu `.prdm.yaml` queda así:

```yaml
version: 2
project:
  id: prj_...
  name: widgets
remote:
  server: https://tu-org.prdm.example
  org: acme
  project: widgets
  offline_policy: warn  # o 'block' si exigís red para cada commit
```

`.prdm/remote/` (la caché de los documentos de governance del servidor) se agrega a `.gitignore`.

### Uso con un code assistant

Después de `prdm link --mcp`, tu `.mcp.json` incluye:

```json
{
  "prdm-remote": {
    "type": "stdio",
    "command": "prdm",
    "args": ["mcp-proxy"]
  }
}
```

Esta entrada es **segura de commitear** — no contiene secretos. `prdm mcp-proxy` resuelve servidor, proyecto y token en tiempo de ejecución desde tu login local y `.prdm.yaml` de este repo exacto, y reenvía cada request de tu code assistant por Streamable HTTP. Se niega a correr si se invoca desde dentro de un `node_modules` (nunca confía en un binario que el propio repo podría controlar), y aborta sin enviar nada si `.prdm.yaml` no coincide con lo que vinculaste (servidor u otro proyecto).

### Workflow de CI: GitHub Actions con OIDC

El CI en modo remoto no corre Neo4j: reporta el estado del código al servidor, y es el servidor quien calcula el drift. Un token OIDC de GitHub Actions prueba que el reporte viene de verdad de tu repo, en la rama por defecto, en un push real.

Ejemplo de `.github/workflows/prdm-sync.yml`:

```yaml
name: prdm-remote-sync

on:
  push:
    branches: [main]  # Solo la rama por defecto puede volverse baseline oficial

permissions:
  contents: read
  id-token: write  # Necesario para pedirle a GitHub el token OIDC

jobs:
  sync-check:
    runs-on: ubuntu-latest
    environment: prdm-ci  # Un Environment de GitHub protegido: solo la rama por defecto llega a estos secrets
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc

      - run: npm ci
      - run: npm run build
      - run: npm run typecheck
      - run: npm test

      # En CI, PRDM_TOKEN es obligatorio (nunca se lee del archivo local de credenciales, que en un
      # runner limpio no existe) y PRDM_SERVER debe coincidir con remote.server de .prdm.yaml.
      - run: node packages/cli/dist/index.js sync --check
        env:
          PRDM_SERVER: ${{ secrets.PRDM_SERVER }}
          PRDM_TOKEN: ${{ secrets.PRDM_TOKEN }}
```

**Puntos clave:**
- `permissions: id-token: write` habilita al job a pedir el token OIDC de GitHub Actions.
- `environment: prdm-ci` (o el nombre que uses) es un [Environment de GitHub](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment) con reglas de protección — así `PRDM_SERVER`/`PRDM_TOKEN` solo son visibles para jobs que corren en la rama por defecto, nunca para un PR de un fork.
- `PRDM_SERVER` y `PRDM_TOKEN` son obligatorios en CI: si falta cualquiera de los dos, `prdm sync` aborta con un error claro en vez de intentar adivinar o caer a un archivo local.
- Nunca uses `pull_request_target` para este job: le daría a código de un fork acceso a estos secretos protegidos.
- El token OIDC se adjunta al reporte automáticamente; el servidor verifica su firma contra el JWKS real de GitHub.

### Git hooks: validación del mensaje de commit

Los developers habilitan el hook `commit-msg` igual que en modo local:

```bash
prdm hooks install
```

El hook valida el trailer `Refs: WO-xxx` en los commits que tocan código gobernado, usando la caché de política del servidor. Si la caché tiene más de 10 minutos, intenta un refetch corto antes de evaluar; sin red, cae al `offline_policy` de `.prdm.yaml`:

```yaml
remote:
  offline_policy: warn  # 'warn' = permite el commit con aviso; 'block' = lo impide
```

### Importar un repo prdm existente

Para adoptar el modo remoto en un repo que ya tiene `.prdm.yaml` y documentos locales:

```bash
# El proyecto remoto de destino debe estar vacío
prdm link acme/widgets --server https://tu-org.prdm.example --import
# Lee y valida docs/, .prdm.yaml y .prdm/baseline.json localmente
# Sube todo al servidor preservando ids, estados y Work Orders
# La baseline importada queda marcada "no verificada por CI" hasta el primer reporte real con OIDC
```

La importación (una sola vez) exige:
- que el proyecto remoto de destino esté vacío;
- permiso de administrador de proyecto;
- que el conjunto de documentos pase la misma validación que corre el servidor al recibirlos.

Una vez importado, el primer push a la rama por defecto con un workflow de CI configurado convierte esa baseline en "verificada".

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
PRDM_WEB_PORT=4600          # Puerto del explorador web (@prdm/web)
PRDM_WEB_HOST=127.0.0.1     # No-loopback requiere PRDM_WEB_ALLOW_REMOTE=1
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

- GitHub App / webhooks (cubierto por CI con `sync --check`)
- Conectores directos a Slack/email (ingesta por archivo o MCP)
- Embeddings / vector index
- Multi-usuario / auth
- Neo4j Enterprise / Aura
