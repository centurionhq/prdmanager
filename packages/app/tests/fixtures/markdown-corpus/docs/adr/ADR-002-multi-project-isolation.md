---
id: ADR-002
type: ADR
title: "Aislamiento multi-proyecto, monorepo y commit atómico"
status: active
architects: ["PRD-002"]
impacts_paths: ["packages/core/src/graph/migrations*.ts", "docs/model/**", "scripts/validate-graph-model.mjs"]
created_at: 2026-09-13
tags: ["architecture-decision", "multi-project", "neo4j", "monorepo", "atomicity"]
---

## Contexto

PRD-002 exige que varios proyectos compartan el motor sin verse entre sí, un core headless reutilizable por futuras interfaces y escrituras atómicas entre disco y Neo4j. En el motor de PRD-001 las constraints eran únicas por `id`, `writeSnapshot` borraba de forma global, no había rollback y el código vivía en un único paquete. Las decisiones se ajustaron el 2026-09-13 tras una revisión de arquitectura y una revisión de base de datos con pruebas sobre Neo4j Community 2026.08.1.

## Decisiones

| # | Decisión | Alternativa descartada | Razón |
|---|---|---|---|
| D1 | `Neo4jGraphDatabase.forProject(ctx)` devuelve un `GraphStore` ligado al proyecto | Pasar `projectId` a cada método | Imposible olvidar el filtro; el dominio conserva sus firmas |
| D2 | `project_id` + constraints únicas compuestas **y** `[:BELONGS_TO]->(:Project)`; deletes filtrados en todos los nodos matcheados | Una base de datos por proyecto; label por proyecto | Multi-database es Enterprise; las constraints compuestas funcionan en Community y crean índice compuesto; labels por proyecto rompen la cardinalidad |
| D3 | Migraciones versionadas en `(:SchemaMigration)` con checksum, escritas tras `awaitIndexes`; destructivas solo con `prdm db migrate`; clientes verifican la versión de esquema | Migrar al arrancar | Evita que un cliente viejo o un servidor MCP borren datos sin pedirlo |
| D4 | Backfill reconstruyendo desde Markdown | Transformar nodos existentes | El grafo es derivado; el estado volátil vive en frontmatter |
| D5 | Full-text `node_text_v2` incluye `project_id` con `standard-no-stop-words`; `project_id` validado por allowlist | Post-filtrar resultados | Verificado: `prj_<16hex>` es un único token sin cruces por prefijo; evita que un proyecto grande deje sin resultados a otro |
| D6 | ID de proyecto `prj_` + 16 hex de `node:crypto`; `(:Project)` guarda la huella de la raíz y `writeSnapshot` rechaza discrepancias (`prdm project claim` la reasigna) | Confiar solo en el ID versionado | Clones, forks y worktrees comparten `.prdm.yaml` y se borrarían mutuamente |
| D7 | `.prdm.yaml` descubierto hacia arriba reemplaza `prdm.config.json`; este repo se adopta con `prdm init --adopt` | Mantener JSON | Contexto implícito pedido por PRD-002; secretos fuera del archivo |
| D8 | Parser `yaml` 2.9.1 con schema `core` | `js-yaml` directo | Sin dependencias, tipos incluidos |
| D9 | Mantener el algoritmo de hash de PRD-001: `impacts_paths` se hashea como `governs`, campos nuevos sin default o volátiles, `## Tareas` excluida del hash de blueprints | Content hash v2 y baseline v2 | Un hash v1 recalculado con el schema nuevo no coincidiría con el baseline; así solo hay que re-baselinear la exclusión de tareas |
| D10 | Transacción atómica: lock con token/pid/heartbeat liberado solo por su dueño, journal por transacción, temp + fsync + link/rename + fsync del directorio, snapshot antes que baseline, replay solo como rollback y marcador `graph-stale` | Journal único y lock por antigüedad | Un proceso lento no puede ver sus escrituras revertidas por otro; Neo4j se corrige desde disco tras un rollback |
| D11 | Refresh completo al hacer commit | Refresh incremental | Drift y ciclo de vida necesitan el proyecto entero; los repos son chicos |
| D12 | Borradores en memoria por proceso MCP, ID definitivo asignado al commit, `draft_dependency` bloqueante y tombstone para reintentos | Reservas provisionales y renumeración con reescritura de referencias | Otros procesos no ven reservas en memoria; la renumeración no corrige texto ni conversación |
| D13 | `lifecycle.grandfathered: [{id, hash}]`; la exención cae si el contenido cambia y CI rechaza que la lista crezca | Lista de IDs o fecha de corte | No falsificable y visible en diffs |
| D14 | Hooks vía `git rev-parse --git-path hooks` con bloques marcados | Sobrescribir `.git/hooks` | Respeta `core.hooksPath`/husky y hooks existentes |
| D15 | Cierre solo por CLI; MCP ofrece `get_closure_readiness` | Tool MCP de cierre | PRD-002 exige ack explícito del arquitecto |
| D16 | Cobertura compartida entre blueprints solo para `code_changed` y `missing`; `Refs` exige un WO abierto cuyo blueprint gobierne un path tocado | Cobertura por blueprint; cualquier WO existente | Blueprints superpuestos (SDD-001 y SDD-002) vuelven a sincronizarse sin ocultar cambios de diseño |
| D17 | `JUSTIFIED_BY` derivado de `INFORMS`/`PROVIDES_CONTEXT_FOR` más `justified_by` opcional | Campo obligatorio en la feature | El triaje escribe en el feedback; exigir el campo en la feature duplicaría enlaces y cambiaría su hash |
| D18 | Sin `project register` ni `prdm new`: el proyecto se registra en el primer `prdm sync` y la autoría por CLI queda fuera | Comandos dedicados | YAGNI; `writeSnapshot` ya hace `MERGE` del proyecto |

## Consecuencias

- **Positivas:** proyectos aislados en una sola instancia Neo4j; `@prdm/core` usable desde CLI, MCP y una futura UI; ninguna escritura parcial ante fallos de Neo4j; hashes existentes preservados.
- **Negativas:** la migración 2 borra el grafo derivado hasta el siguiente `prdm sync`; mover el código a `packages/` exige re-baselinear SDD-001 por ID; los borradores no sobreviven reinicios del servidor MCP; las constraints únicas no garantizan la existencia de `project_id` (lo verifica `prdm db doctor`); el gate de cierre por proyecto impide cerrar una feature mientras otra tiene drift.
- **Nota:** el texto de la tarea de WO-018 menciona "content hash v2, baseline v2"; se conserva para no duplicar el WO, y su alcance real es el de D9.

## Tareas

- [ ] Validar el modelo multi-proyecto con neo4j-data-modeling y actualizar docs/model/graph-model.json
