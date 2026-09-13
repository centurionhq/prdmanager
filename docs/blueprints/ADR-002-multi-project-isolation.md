---
id: ADR-002
type: ADR
title: "Aislamiento multi-proyecto, monorepo y commit atómico"
status: active
architects: ["PRD-002"]
governs: ["package.json", "tsconfig*.json", "vitest.config.ts", "packages/*/package.json", "packages/core/src/graph/migrations*.ts"]
created_at: 2026-09-13
tags: ["architecture-decision", "multi-project", "neo4j", "monorepo", "atomicity"]
---

## Contexto

PRD-002 exige que varios proyectos compartan el motor sin verse entre sí, un core headless reutilizable por futuras interfaces y escrituras atómicas entre disco y Neo4j. En el motor de PRD-001 las constraints eran únicas por `id`, `writeSnapshot` borraba de forma global, no había rollback y el código vivía en un único paquete.

## Decisiones

| # | Decisión | Alternativa descartada | Razón |
|---|---|---|---|
| D1 | `Neo4jGraphDatabase.forProject(ctx)` devuelve un `GraphStore` ligado al proyecto | Pasar `projectId` a cada método | Imposible olvidar el filtro; el dominio conserva sus firmas |
| D2 | `project_id` + constraints únicas compuestas **y** `[:BELONGS_TO]->(:Project)` | Una base de datos por proyecto | Community permite una sola base de usuario; las constraints compuestas sí están en Community |
| D3 | Migraciones versionadas en `(:SchemaMigration)` con checksum | Solo `IF NOT EXISTS` | Hace falta eliminar constraints viejas de forma controlada |
| D4 | Backfill reconstruyendo desde Markdown | Transformar nodos existentes | El grafo es derivado; el estado volátil vive en frontmatter |
| D5 | Full-text `node_text_v2` incluye `project_id` en la query Lucene | Post-filtrar resultados | Evita que un proyecto grande deje sin resultados a otro |
| D6 | ID de proyecto `prj_` + 16 hex de `node:crypto` | ULID | Sin dependencia nueva, no expone timestamps, un token Lucene |
| D7 | `.prdm.yaml` descubierto hacia arriba reemplaza `prdm.config.json` | Mantener JSON | Contexto de proyecto implícito pedido por PRD-002; secretos fuera del archivo |
| D8 | Parser `yaml` 2.9.1 con schema `core` | `js-yaml` directo | Sin dependencias, tipos incluidos, conserva comentarios para `init --adopt` |
| D9 | Content hash v2 omite valores vacíos y usa claves canónicas | Mantener hash v1 | Renombres y campos nuevos no generan drift; `migrate docs` preserva el estado |
| D10 | Commit atómico con journal `.prdm/journal.json`, temp + fsync + link/rename, snapshot antes que baseline | Escritura directa | Si Neo4j falla, se restauran archivos y baseline |
| D11 | Refresh completo al hacer commit | Refresh incremental | Drift y ciclo de vida necesitan el proyecto entero; los repos son chicos |
| D12 | Borradores en memoria por proceso MCP con límites | Persistir borradores en disco | PRD-002 pide no tocar el filesystem; `list_drafts` hace visible la pérdida al reiniciar |
| D13 | `lifecycle.grandfathered` explícito | Fecha de corte por `created_at` | Revisable en diffs y no falsificable |
| D14 | Hooks vía `git rev-parse --git-path hooks` con bloques marcados | Sobrescribir `.git/hooks` | Respeta `core.hooksPath`/husky y hooks existentes |
| D15 | Cierre solo por CLI; MCP ofrece `get_closure_readiness` | Tool MCP de cierre | PRD-002 exige ack explícito del arquitecto |
| D16 | Cobertura compartida entre blueprints que gobiernan el mismo archivo | Cobertura por blueprint | Blueprints superpuestos (SDD-001 y SDD-002) nunca volverían a sincronizarse |

## Consecuencias

- **Positivas:** proyectos aislados en una sola instancia Neo4j; `@prdm/core` usable desde CLI, MCP y una futura UI; ninguna escritura parcial ante fallos de Neo4j.
- **Negativas:** la migración 2 borra el grafo derivado hasta el siguiente `prdm sync`; mover el código a `packages/` exige re-baselinear SDD-001; borradores no sobreviven reinicios del servidor MCP; las constraints únicas no garantizan la existencia de `project_id` (lo verifica `prdm db doctor`).

## Tareas

- [ ] Validar el modelo multi-proyecto con neo4j-data-modeling y actualizar docs/model/graph-model.json
