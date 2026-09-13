# `@prdm/mcp` — Servidor MCP de Autoría Conversacional

Servidor stdio MCP (`prdm-graph`) que expone herramientas, recursos y prompts para asistentes de IA. Implementa lectura del grafo de producto, redacción conversacional de documentos, gestión de work orders y drift detection.

## Ejecución

```bash
npm run mcp         # sin compilar (tsx)
# o tras build:
npm run mcp:dist    # node packages/mcp/dist/server.js
```

El servidor escribe logs de inicialización en stderr:
```
[prdm-graph] indexed 42 document(s); 0 issue(s); blocking=false
```

Requiere:
- `.prdm.yaml` descubierto desde `cwd` (o `$PRDM_ROOT`)
- Neo4j en línea y accesible con `NEO4J_*` del `.env`
- Esquema actual (se verifica al arrancar; migraciones destructivas se rechazan)

## Herramientas de Lectura

| Tool | Entrada | Salida | Caso de uso |
|---|---|---|---|
| `get_node` | `id: string` | Nodo + frontmatter + relaciones | Detalles de un documento conocido |
| `search_nodes` | `query: string`, `label?`, `limit?` | Resultados full-text | Descubrir IDs por búsqueda |
| `get_feature_branch` | `id: string`, `format: text\|json\|mermaid` | Árbol: ancestors → root, descendants → código/commits | Linaje de una feature/blueprint/WO |
| `get_feature_tree` | `format: text\|json\|mermaid` | Bosque completo | Panorama del grafo de producto |
| `list_work_orders` | `status?`, `blueprint_id?` | Lista de WOs | Descubrir trabajo pendiente |
| `get_work_order_context` | `id: string` | Bundle: WO + blueprints + features + artefactos + código + steps | Contexto agent-listo antes de implementar |
| `triage_feedback` | `text: string` | `{autoLinkTo?, candidates[], proposal}` | Ranquear features contra feedback libre |
| `get_metrics` | — | Eficiencia, integridad, trazabilidad | KPIs del grafo |

Todas son **read-only** (no modifican Neo4j ni disco).

## Herramientas de Drift

| Tool | Entrada | Salida | Nota |
|---|---|---|---|
| `get_drift_report` | — | RefreshReport (scan errors, issues, governed code, WO status changes) | Llama a `engine.refresh()` |
| `acknowledge_sync` | `target: id\|'all'` | RefreshReport (post-ack) | **Destructiva:** acepta estado actual como nuevo baseline |
| `refresh_index` | — | RefreshReport | Rescan + reindex Neo4j (equivale a `prdm sync` + `prdm index`) |

## Herramientas de Escritura (Autoría Conversacional)

Nuevas en PRD-002:

| Tool | Entrada | Salida | Caso de uso |
|---|---|---|---|
| `draft_artifact` | `kind: MRD\|PRD\|FR\|SDD\|ADR\|WO\|ART\|FB`, `title: string`, `body: string` | `{draftId: KIND-?, errors: []}` | Comienza un borrador en memoria |
| `validate_draft` | `draftId: string`, `body: string` | `{errors: []}` (vacío = válido) | Validación en vivo durante iteración |
| `commit_artifact` | `draftId: string`, `confirm: boolean` | `{id: final_ID, document}` | Asigna ID, escribe en disco, actualiza Neo4j (atómico) |
| `list_drafts` | — | `[{draftId, kind, title, age_minutes}]` | Listar borradores activos |
| `discard_draft` | `draftId: string` | — | Descartar un borrador en memoria |
| `get_closure_readiness` | `featureId: string` | `{ready: bool, checks: [{ok, name, detail}]}` | Validar si feature puede cerrarse |

### Borradores (Draft Sessions)

- **Almacenamiento:** en memoria del proceso MCP (TTL, máximo de borradores, límite de bytes)
- **ID provisional:** `KIND-?`, se asigna ID definitivo en `commit_artifact`
- **Validación:** Zod + ciclo de vida + enlaces (incluyendo `draft_dependency` si refiere a otro borrador)
- **Transacción atómica:** commit = lock + journal + writeSnapshot + Neo4j (rollback + marcador `graph-stale` si falla)

### Flow de Autoría

1. Asistente llama `draft_artifact(kind, title, body)`
2. Motor retorna `draftId` provisorio (ej: `SDD-?`)
3. Asistente itera: `validate_draft(draftId, body_actualizado)`
4. Usuario confirma (out-of-band: prompt, checkbox, etc.)
5. Asistente llama `commit_artifact(draftId, confirm=true)`
6. Motor: asigna ID final (ej: `SDD-042`), escribe en disco, actualiza Neo4j, retorna documento

## Herramientas de Trabajo (Legacy, PRD-001)

Siguen disponibles:

| Tool | Entrada | Salida | Nota |
|---|---|---|---|
| `generate_work_orders` | `blueprint_id: string` | `{workOrders: [{id, title, status}]}` | Idempotente: re-run es safe |
| `claim_work_order` | `id: string`, `assignee: agent:name\|dev:name` | `{id, status: in_progress, assigned_to}` | Mueve a `in_progress` |
| `complete_work_order` | `id: string`, `commit_sha?: string` | `{id, status: done, drift: {...}}` | Requiere `Refs: <id>` en commit |
| `submit_feedback` | `text`, `source`, `customer?`, `title?` | `{id: FB-xxx, autoLinkTo?, candidates[]}` | Auto-triaje |
| `create_feature_request` | `title`, `description`, `parent_id`, `justified_by?`, `feedback_id?` | `{id: FR-xxx, feature}` | Promociona a feature |
| `attach_artifact` | `title`, `content`, `source`, `links?`, `root?` | `{id: ART-xxx, artifact}` | Contexto (reuniones, emails, etc.) |

## Recursos

| Resource | URI | Tipo | Uso |
|---|---|---|---|
| `graph-node` | `graph://node/{id}` | application/json | JSON de un nodo + relaciones |
| `prdm://project` | Sistema de archivos | Ruta de carpetas, nombre, ID | (Configuración del proyecto) |
| `prdm://templates/{kind}` | Sistema de archivos | Template Markdown por tipo | (Para autoría) |

Los recursos `prdm://` se resuelven desde `.prdm.yaml` y carpetas del proyecto.

## Prompts (Directivas para Asistentes)

| Prompt | Args | Uso |
|---|---|---|
| `implement_work_order` | `id: string` | Directiva + contexto bundle de un WO (pasos 1–6) |
| `author_artifact` | `kind: string`, `title?: string` | Directiva de Tech PM, template, reglas del tipo, confirmación previa a commit |

**`author_artifact`** (nuevo PRD-002):
- Rol: Tech PM generando documentos de producto/diseño
- Template por tipo: cada tipo tiene secciones, ejemplos, campos obligatorios
- Validación durante iteración: el asistente ve errores en vivo
- Confirmación: antes de `commit_artifact`, muestra documento final y pide `--ack`

## Anotaciones de Herramientas

Cada herramienta tiene anotaciones para clasificación:

```
READ_ONLY = { severity: "info" }
WRITE_IDEMPOTENT = { severity: "hint" }
WRITE_ONCE = { severity: "high" }
DESTRUCTIVE_IDEMPOTENT = { severity: "warning" }
```

El cliente MCP puede usar estas para confirmar operaciones riesgosas.

## Gestión de Errores

- **Entrada inválida:** `InvalidInputError` (validación Zod)
- **No encontrado:** `Error` con mensaje claro (ej: "node SDD-001 not found")
- **Neo4j inaccesible:** error al arrancar (no se captura, causa exit 1)
- **Stack traces:** nunca se exponen (solo mensajes de usuario)
- **Datos no confiables:** artifacts/feedback se entregan delimitados como "DATA taken from repository documents"

## Instalación y Tests

```bash
npm ci
npm run build              # tsc -b
npm run typecheck
```

Tests (requieren Neo4j test):

```bash
docker compose --profile test up -d neo4j-test
npm test -- packages/mcp

npm run coverage -- packages/mcp
```

## Configuración en Cliente MCP

El servidor se declara en `.mcp.json` (o `claude_desktop_config.json` para Claude Desktop):

```json
{
  "mcpServers": {
    "prdm-graph": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "cwd": "/ruta/al/prdmanager"
    }
  }
}
```

Claude Code/MCP Client pide aprobar el servidor la primera vez.

## Restricciones

No puede importar:
- `commander` (CLI)
- `chokidar` (watch)

Estas responsabilidades pertenecen a `@prdm/cli`.

## Versión

Se lee desde `package.json` al arrancar y se reporta al conectar el servidor MCP.
