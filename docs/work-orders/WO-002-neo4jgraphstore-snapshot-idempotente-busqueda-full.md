---
id: "WO-002"
type: "WO"
title: "Neo4jGraphStore: snapshot idempotente, búsqueda full-text, ramas con APOC y métricas"
status: "out_of_sync"
created_at: "2026-09-13"
implements: ["SDD-001"]
governs: ["src/domain/**","src/parser/**","src/graph/**","src/sync/**","src/engine.ts","src/config.ts","src/util/**","src/workorders/**","src/feedback/**","src/artifacts/**","src/metrics/**","src/mcp/**","src/cli/**"]
source_task: "b8e89124dc5467ae"
tags: ["architecture","neo4j","doc-as-code","mcp","product-management"]
blueprint_hashes: {"SDD-001":"d0fe813903179f4e7ab6e77281c24ef50d346558575dd44291a042de75ce1f21"}
---

## Objetivo
Neo4jGraphStore: snapshot idempotente, búsqueda full-text, ramas con APOC y métricas

## Contexto
SDD-001 — Arquitectura del Product & Context Graph Engine; features: PRD-001

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-001
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-002`
