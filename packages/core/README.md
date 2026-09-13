# `@prdm/core` — Motor de Dominio Headless

Núcleo de prdmanager: parser Markdown, validación Zod, grafo Neo4j, autoría conversacional y ciclo de vida determinista. Sin dependencias de CLI o MCP, reutilizable desde cualquier interfaz.

## Responsabilidades

| Módulo | Función |
|---|---|
| `domain/` | Esquema de documentos (MRD, PRD, FR, SDD, ADR, WO, ART, FB); tipos de frontmatter; parsing de YAML |
| `parser/` | Gray-matter + validación Zod; extracción de símbolos; análisis de enlaces |
| `project/` | Carga y validación `.prdm.yaml`; descubrimiento del proyecto activo |
| `graph/` | Neo4j driver, migraciones versionadas, queries Cypher; multi-proyecto con particiones |
| `sync/` | Refresh desde documentos; drift detection; política de commits |
| `authoring/` | Draft sessions persistidas en `.prdm/drafts/`; validación en vivo; commit atómico con journal |
| `lifecycle/` | Máquina de estados (ingesta, definición, diseño, planificación, ejecución, cierre) |
| `work-orders/` | Generación idempotente de WOs desde blueprints |
| `metrics/` | Cobertura, complejidad, anomalías |
| `util/` | safe-fs, fechas, regexes, helpers |

## Entry Points Públicos

```typescript
// Config
import { loadConfig, type PrdmConfig } from '@prdm/core';
const config = loadConfig('/ruta/proyecto');

// Neo4j
import { Neo4jGraphDatabase, type GraphStore } from '@prdm/core';
const db = Neo4jGraphDatabase.connect(config.neo4j);
const store = db.forProject(config.project);

// Motor principal
import { Engine } from '@prdm/core';
const engine = new Engine(config, store);
const report = await engine.refresh();

// Autoría conversacional
import { AuthoringService } from '@prdm/core';
const authoring = new AuthoringService(engine);
const draft = await authoring.draft({ kind: 'SDD', title: '...', body: '...' });
const validated = await authoring.validate(draft.id, updatedBody);
const committed = await authoring.commit(draft.id);

// Ciclo de vida
import { checkLifecycle, closeFeature, closureReadiness } from '@prdm/core';

// Parser
import { parseMarkdown } from '@prdm/core';
const { frontmatter, body, node } = parseMarkdown(markdown, 'PRD-001');
```

## Funciones Clave Sin Bases de Datos

Estas no requieren conexión Neo4j:

```
parseProjectFile(yaml), renderProjectFile(settings), generateProjectId()
checkCommitMessage(root, message, options), checkCommitRange(root, range)
```

(**Nota:** `migrateDocs` sí requiere Engine/Neo4j para el refresh final)

## Instalación de Dependencias

```bash
npm ci
npm run build              # TypeScript incremental
npm run typecheck          # Type checking
```

## Tests

```bash
# Unit + integración (requiere Neo4j test en 127.0.0.1:7688)
docker compose --profile test up -d neo4j-test
npm test -- packages/core

# Cobertura
npm run coverage -- packages/core
```

## Restricciones

No puede importar:
- `commander` (CLI)
- `chokidar` (watch)
- `@modelcontextprotocol/*` (MCP)

Estas responsabilidades pertenecen a `@prdm/cli` y `@prdm/mcp`.
