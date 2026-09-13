# prdmanager — Product & Context Graph Engine

Implementación de [PRD-001](PRD-001-Graph-Engine-Enhanced.md): un grafo de producto que une **Feature Tree** (MRD/PRD/FR), **Blueprints** (SDD/ADR), **Work Orders**, **Artifacts**, **Feedback** y **código**. Asistentes de IA lo usan vía MCP, y el grafo detecta cuándo la documentación y el código se desincronizan.

- **Doc-as-code:** los `.md` con frontmatter YAML son la fuente de verdad, versionada en git.
- **Neo4j local** es el índice vivo del grafo y se puede reconstruir siempre desde los documentos.
- **La IA es el cliente MCP:** el motor entrega contexto y candidatos deterministas, y el asistente decide.

Arquitectura: [SDD-001](docs/blueprints/SDD-001-graph-engine.md) · Decisión de base de datos: [ADR-001](docs/blueprints/ADR-001-neo4j-local.md) · Mercado: [MRD-001](docs/mrd/MRD-001.md) · Modelo validado: [docs/model/graph-model.json](docs/model/graph-model.json)

## Stack

| Capa | Tecnología |
|---|---|
| Base de grafos | Neo4j Community `2026.08.1` + APOC `2026.08.1` en una red Docker interna sin salida a internet, expuesto solo en 127.0.0.1 vía proxy `alpine/socat:1.8.0.3` |
| Runtime | Node.js 20.20.2, npm 10.8.2, TypeScript 7.0.2 (ESM), tsx 4.23.13 |
| Driver / MCP | neo4j-driver 6.2.0, @modelcontextprotocol/sdk 1.30.0 |
| Parsing / validación | gray-matter 4.0.3, zod 4.6.3, fast-glob 3.3.3 |
| CLI | commander 14.0.3, chokidar 5.0.0, dotenv 17.4.2 |
| Tests | vitest 4.1.11 + @vitest/coverage-v8 4.1.11 |

`commander` y `vitest` usan la última versión compatible con Node 20 (las mayores siguientes requieren Node ≥ 22.12).

## Setup

```bash
# 1. Secretos locales
cp .env.example .env && sed -i "s/^NEO4J_PASSWORD=.*/NEO4J_PASSWORD=$(openssl rand -hex 16)/" .env

# 2. Base de grafos + proxy localhost (Browser en http://localhost:7474)
docker compose up -d

# 3. Tooling de gestión: neo4j-mcp 1.6.0 (checksum verificado) + uv
./scripts/install-tooling.sh

# 4. Dependencias, esquema e indexación del propio repo
npm ci
npm run prdm -- db migrate
npm run prdm -- index
npm run prdm -- tree MRD-001
```

## Servidores MCP (`.mcp.json`)

| Servidor | Qué hace |
|---|---|
| `prdm-graph` | **El producto.** Tools para Feature Tree, Work Orders, drift, feedback, artifacts y métricas. Se levanta con `npx tsx --conditions=@prdm/source packages/mcp/src/server.ts` (o `npm run mcp`). |
| `neo4j` | MCP oficial `neo4j/mcp` v1.6.0 (`get-schema`, `read-cypher`). `scripts/mcp-neo4j.sh` lee `.env` sin ejecutarlo y fuerza **solo lectura**: el grafo es un índice derivado de los documentos. Para administrar a mano usar `cypher-shell` o Neo4j Browser. |
| `neo4j-data-modeling` | `mcp-neo4j-data-modeling@0.8.2` vía `uvx`: valida y exporta el modelo de grafo. |

Claude Code pide aprobar los servidores del proyecto la primera vez; `claude mcp list` muestra su estado.

## Skills

Plugin de proyecto **`neo4j-skills@neo4j-skills-marketplace`** v1.0.1 (declarado en `.claude/settings.json`), con skills de Cypher 25, modelado, driver JavaScript v6, MCP, CLI tools y más. La URI, el usuario y la base ya están configurados. La contraseña es sensible, así que se configura una sola vez con:

```
/plugin configure neo4j-skills@neo4j-skills-marketplace
```

## Modelo de documentos

| Tipo | Label Neo4j | Enlaces en frontmatter → relación |
|---|---|---|
| `MRD`, `PRD`, `FR` | `:Feature` | `implements` / `evolves_from` → `EVOLVES_FROM` |
| `SDD`, `ADR` | `:Blueprint` | `architects` → `ARCHITECTS`; `governs: ["src/x/**", "src/y.ts#symbol"]` → `(:CodeRef)-[:GOVERNED_BY]->` |
| `WO` | `:WorkOrder` | `implements` → `IMPLEMENTS`; `assigned_to: agent:x` → `ASSIGNED_TO` |
| `ART` | `:Artifact` | `provides_context_for` → `PROVIDES_CONTEXT_FOR` |
| `FB` | `:Feedback` | `informs` → `INFORMS` |
| commit con trailer `Refs: WO-012` | `:Commit` | `RESOLVES` |

## CLI `prdm`

Ejecutar con `npm run prdm -- <comando>` (o `npx tsx --conditions=@prdm/source packages/cli/src/index.ts <comando>`, o `node packages/cli/dist/index.js <comando>` tras `npm run build`).

| Área | Comandos |
|---|---|
| Proyecto (PRD-002 F-07) | `init [dir] --name <n> [--adopt] [--no-hooks] [--mcp] [--force]`, `hooks install [--force]` |
| Base de datos | `db up`, `db migrate`, `db status`, `db reset --yes` |
| Índice (F-01) | `index`, `lint`, `ingest artifact <file> --source call [--link PRD-001]` |
| Feature Tree (F-02) | `tree [ID] --format text\|json\|mermaid`, `node <ID>`, `search <texto> [--label Feature]` |
| Drift (F-03) | `sync`, `sync --check` (exit ≠ 0 para CI), `sync ack <ID\|all>` (blueprint, feature o WO), `watch` |
| Work Orders (F-04) | `wo generate <SDD-ID>`, `wo list [--status todo]`, `wo context <WO-ID>`, `wo claim <WO-ID> --as agent:claude`, `wo complete <WO-ID> --commit HEAD` |
| Feedback (F-05) | `feedback add --text "..." --source email`, `feedback triage --text "..."`, `fr create --title ... --parent PRD-001 --from-feedback FB-001` |
| Métricas (§6) | `metrics [--json]` |
| Política de commits (PRD-002 F-07) | `check commit-msg <file>` (usado por el hook `commit-msg`), `check commits --range <a..b>` (CI) — ninguno de los dos necesita Neo4j |

`prdm init` nunca abre una conexión a Neo4j: solo escribe `.prdm.yaml`, las carpetas `docs/<tipo>/` y los hooks de git, así que funciona sin `NEO4J_PASSWORD`. `--adopt` convierte un `prdm.config.json` existente (sin borrarlo). `hooks install` (también invocado por `init` salvo `--no-hooks`) escribe bloques marcados `# >>> prdm <id> >>>` en `post-commit` (`prdm sync`) y `commit-msg` (`prdm check commit-msg`) en el directorio que reporte `git rev-parse --git-path hooks` (respeta `core.hooksPath`/husky y hooks existentes; reintentar es un no-op). El hook `commit-msg` exige un trailer `Refs: WO-xxx` de un work order `pending`/`in_progress`/`out_of_sync` de este proyecto cuando el commit toca código gobernado por un `SDD`/`ADR`; `PRDM_SKIP_HOOKS=1` desactiva ambos hooks para un commit puntual.

## Flujo de trabajo

1. **Arquitecto:** escribe un blueprint con `governs` y una sección `## Tareas`, y ejecuta `prdm wo generate SDD-001`.
2. **Asistente (MCP):** `claim_work_order` → `get_work_order_context` (WO, blueprint, linaje de features, artifacts, código gobernado, drift) → implementa solo dentro del código gobernado → commit con trailer `Refs: WO-00X` → `complete_work_order` con el sha.
3. **Drift:** si cambia un blueprint, sus WOs terminados pasan a `out_of_sync` y su código gobernado queda marcado. Si cambia código gobernado sin un commit `Refs:` de un WO vigente, también. `prdm sync ack SDD-001` acepta el nuevo diseño y su código, pero los WOs construidos sobre el diseño anterior siguen `out_of_sync` hasta que se re-completan (`complete_work_order` exige un commit existente con `Refs: WO-xxx`) o se aceptan uno por uno con `prdm sync ack WO-xxx`.
4. **Feedback:** `submit_feedback` / `triage_feedback` enlazan por mención explícita o por el índice full-text. Si no hay un match claro, el asistente decide si crea un `FR` con `create_feature_request`.
5. **CI (repositorio conectado):** [.github/workflows/prdm-sync.yml](.github/workflows/prdm-sync.yml) corre typecheck, tests unitarios y `prdm sync --check` contra un servicio Neo4j en cada push/PR. Requiere el secret `NEO4J_PASSWORD`; se activa al publicar el repo en GitHub.

El estado reconocido vive en `.prdm/baseline.json` (versionado): su diff en un PR muestra qué cambios se aceptaron.

## Tests

```bash
docker compose --profile test up -d neo4j-test   # instancia efímera en 127.0.0.1:7688
npm test                                         # unit + integración + e2e MCP
npm run coverage                                 # umbral 80 %
```

Los tests de integración nunca usan la base de desarrollo (el helper se niega si la URI coincide).

## Seguridad

- **Filesystem:** toda lectura y escritura pasa por `packages/core/src/util/safe-fs.ts`, que resuelve el realpath, rechaza symlinks que salgan del repo, abre con `O_NOFOLLOW` y limita tipo y tamaño de archivo.
- **Neo4j:** Cypher siempre parametrizado; allowlist de procedimientos APOC (`apoc.path.*`, `apoc.coll.*`, `apoc.meta.*`, `apoc.version`). El contenedor no tiene salida a internet, así que `LOAD CSV` no puede exfiltrar datos.
- **MCP:** inputs validados con zod; errores sin stack traces; `acknowledge_sync` marcado como destructivo; el contenido de artifacts y feedback se entrega delimitado como datos no confiables.
- **Concurrencia:** lockfile `.prdm/engine.lock` entre CLI, hook, `watch` y servidor MCP.

## Fuera del MVP

UI web propia (se cubre con Neo4j Browser, Mermaid y MCP), GitHub App/webhooks (se cubre con `sync --check` en CI), conectores directos a Slack/email (la ingesta es por archivo o por contenido vía MCP), embeddings/vector index, multiusuario/auth y Neo4j Enterprise/Aura.

## Limitaciones conocidas

- El triaje por full-text usa scores Lucene sin normalizar. Con pocos documentos las diferencias entre candidatos son chicas, así que conviene ajustar `triage.autoLinkMinScore`/`autoLinkMargin` en `prdm.config.json` a medida que crece el corpus.
- La extracción de símbolos (`archivo#símbolo`) es heurística: llaves para TS/JS (ignorando strings y comentarios de una línea) e indentación para Python. Los template literals multilínea no se analizan; ante bloques ambiguos hashea hasta el final del archivo, así que reporta drift de más en lugar de de menos.
- `LOAD CSV` sigue permitido dentro de la red interna de Docker (Community no tiene blocklist de URLs); no hay salida a internet.
