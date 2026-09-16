---
id: "ART-002"
title: "Plan de ejecución de PRD-002 con subagentes expertos"
status: "active"
created_at: "2026-09-13"
tags: []
type: "ART"
source: "doc"
provides_context_for: ["PRD-002"]
---

## Contenido

Resumen del plan aprobado el 2026-09-13 para PRD-002. El diseño detallado vive en SDD-002 y las decisiones en ADR-002.

- Hallazgos previos: `writeSnapshot` y `clear()` borraban de forma global; no existía rollback si fallaba Neo4j (el baseline se guardaba antes del snapshot); los IDs salían de un scan de archivos; el content hash dependía de nombres de claves y defaults; SDD-001 gobernaba todo `src/**`.
- Fases: P0 gobernanza → P1 monorepo y cobertura compartida → P2 multi-proyecto, `.prdm.yaml` y renombres en paralelo → P3 autoría atómica, ciclo de vida, `prdm init` y enforcement de Refs en paralelo → P4 herramientas MCP y documentación → P5 dogfooding end-to-end → P6 revisiones de correctitud, seguridad y arquitectura → cierre de PRD-002 por el usuario.
- Subagentes: product-manager, architect-reviewer, database-administrator, backend-developer, fullstack-developer, mcp-developer, technical-writer y general-purpose, con ownership de archivos disjunto y una instancia Neo4j efímera por agente paralelo.
- Skills: neo4j-cypher-skill, neo4j-modeling-skill, neo4j-driver-javascript-skill, neo4j-mcp-skill y neo4j-cli-tools-skill, más los MCP `neo4j` (solo lectura) y `neo4j-data-modeling`.
- Criterio de éxito §5 (iteración Tree-sitter) queda para un PRD posterior; PRD-002 permanece approved hasta que PRD-003 cumpla ese criterio en un proyecto creado con `prdm init` (ver ART-003).
