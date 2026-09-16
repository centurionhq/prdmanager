---
id: "WO-026"
type: "WO"
title: "Mantener la infraestructura local de Neo4j, el proxy y el tooling MCP gobernados por este ADR"
status: "pending"
created_at: "2026-09-13"
implements: ["ADR-001"]
impacts_paths: ["docker-compose.yml","scripts/**",".mcp.json"]
source_task: "09df0116d8f78a5e"
tags: ["architecture-decision","neo4j","database","docker"]
---

## Objetivo
Mantener la infraestructura local de Neo4j, el proxy y el tooling MCP gobernados por este ADR

## Contexto
ADR-001 — Neo4j Community local como base de datos de grafos; features: PRD-001

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-001
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-026`
