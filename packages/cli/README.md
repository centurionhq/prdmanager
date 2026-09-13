# `@prdm/cli` — Interfaz de Línea de Comandos

Binario `prdm`: orchestration de `@prdm/core` para usuarios finales. Gestión de proyectos, base de datos, sync, work orders, feedback, cierre de features y política de commits.

## Entry Point

```bash
npm run prdm -- <comando> [opciones]
# o tras build:
node packages/cli/dist/index.js <comando> [opciones]
```

## Estructura

| Módulo | Responsabilidad |
|---|---|
| `commands/` | Registradores de comandos Commander.js para cada área (db, project, graph, sync, wo, etc.) |
| `program.ts` | Creación del programa, contexto de CLI, validación de esquema |
| `errors.ts` | CliError, messageOf, formateo de errores |
| `format.ts` | Formateo de reportes (refresh, metrics, etc.) |
| `index.ts` | Entrypoint: carga root, abre contexto, ejecuta programa |

## Comandos por Área

### Proyecto

```
prdm init [dir] --name <nombre> [--adopt] [--no-hooks] [--mcp] [--force]
prdm hooks install [--force]
prdm project list
prdm project claim
prdm project remove <id> --yes
```

Sin Neo4j: `init`, `hooks install`.

### Base de Datos

```
prdm db up                    # docker compose start
prdm db migrate               # migraciones (destructivas explícitas)
prdm db status                # conectividad, versión, proyectos
prdm db reset --yes           # limpiar partición
prdm db doctor                # verificar integridad
```

Sin Neo4j: ninguno.

### Índice

```
prdm index                    # scan y actualización del grafo
prdm lint                     # errores de parsing
```

### Feature Tree

```
prdm tree [ID] --format text|json|mermaid
prdm node <ID>
prdm search <texto> [--label Feature|...]
```

### Drift y Sync

```
prdm sync                     # leer drifts
prdm sync --check             # validar (exit 0 = ok, ≠0 = hay drift)
prdm sync ack <ID|all>
prdm watch                    # monitoreo continuo (chokidar)
```

### Work Orders

```
prdm wo generate <SDD-ID>
prdm wo list [--status <estado>]
prdm wo context <WO-ID>
prdm wo claim <WO-ID> --as agent:claude
prdm wo complete <WO-ID> --commit <sha>
```

### Feedback

```
prdm feedback add --text "..." --source <fuente>
prdm feedback triage --text "..."
prdm fr create --title ... --parent <FEATURE-ID> [--from-feedback <FB-ID>]
```

### Artefactos

```
prdm ingest artifact <archivo> --source <meeting|email|slack|call|doc|other> [--link <FEATURE-ID>]
```

### Cierre

```
prdm close <FEATURE-ID> --ack --by dev:nombre
prdm closure-readiness <FEATURE-ID> [--json]
```

### Política de Commits

```
prdm check commit-msg <archivo>
prdm check commits --range origin/main..HEAD
```

Sin Neo4j: ambos.

### Otras

```
prdm migrate docs [--dry-run]
prdm metrics [--json]
```

## Contexto de CLI

Todas las rutas abierto un `CliContext`:
```typescript
interface CliContext {
  config: PrdmConfig;           // .prdm.yaml + .env
  db: GraphDatabase;            // Neo4j driver
  store: GraphStore;            // Partición de este proyecto
  engine: Engine;               // Motor de dominio
  close(): Promise<void>;
}
```

La mayoría de comandos verifica `assertSchemaCurrent()` al abrir (excepto `db migrate`, `db status`, `check *`, `init`, etc.).

## Instalación de Dependencias

```bash
npm ci
npm run build              # tsc -b
npm run typecheck          # type check
```

## Tests

```bash
npm test -- packages/cli

npm run coverage -- packages/cli
```

## Restricciones

No puede importar:
- `chokidar` (ver: `@prdm/mcp`)
- `@modelcontextprotocol/*` (ver: `@prdm/mcp`)

Importa solo de `@prdm/core` y librerías estándar (commander, etc.).
