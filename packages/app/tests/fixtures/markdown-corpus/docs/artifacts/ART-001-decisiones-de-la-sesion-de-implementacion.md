---
id: "ART-001"
type: "ART"
title: "Decisiones de la sesión de implementación"
status: "active"
created_at: "2026-09-13"
source: "doc"
provides_context_for: ["PRD-001"]
---

## Contenido

Resumen de decisiones de la sesión de implementación de PRD-001 (2026-09-12).

- Pedido del usuario: tecnologías explícitas, base de grafos como servicio local, MCPs y skills para gestionarla, y uso de subagentes.
- Base de grafos: Neo4j Community 2026.08.1 con APOC en Docker, red interna sin salida a internet y proxy socat en 127.0.0.1.
- Gestión: MCP oficial neo4j-mcp 1.6.0 en solo lectura, mcp-neo4j-data-modeling 0.8.2 y plugin neo4j-skills 1.0.1.
- Motor: TypeScript 7 sobre Node 20; los documentos markdown son la fuente de verdad y Neo4j es un índice derivado del motor de grafos.
- Drift: baseline versionado, trailers Refs en commits y blueprint_hashes en los work orders.
- Revisiones independientes de correctitud y seguridad: se corrigieron escapes por symlink, ReDoS, reglas de baseline y exfiltración vía LOAD CSV.
