---
id: "WO-008"
type: "WO"
title: "CLI prdm con comandos de índice, árbol, drift, work orders y feedback"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-001"]
governs: ["src/domain/**","src/parser/**","src/graph/**","src/sync/**","src/engine.ts","src/config.ts","src/util/**","src/workorders/**","src/feedback/**","src/artifacts/**","src/metrics/**","src/mcp/**","src/cli/**"]
source_task: "335bcfbee04f70d7"
tags: ["architecture","neo4j","doc-as-code","mcp","product-management"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T01:18:15.581Z"
completed_at: "2026-09-13T01:18:47.518Z"
resolved_by: ["d090678c5b59d768747d0bef2915b9117a1599cd"]
blueprint_hashes: {"SDD-001":"d6a000ed064775020375fa85f68494c8ce55428260c73562eda0fbfa6bbb0aa7"}
---

## Objetivo
CLI prdm con comandos de índice, árbol, drift, work orders y feedback

## Contexto
SDD-001 — Arquitectura del Product & Context Graph Engine; features: PRD-001

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-001
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-008`
