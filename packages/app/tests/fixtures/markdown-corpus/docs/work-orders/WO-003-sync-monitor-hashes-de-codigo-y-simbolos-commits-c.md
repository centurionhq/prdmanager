---
id: "WO-003"
type: "WO"
title: "Sync Monitor: hashes de código y símbolos, commits con trailers Refs, baseline y reglas de drift"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-001"]
impacts_paths: ["src/domain/**","src/parser/**","src/graph/**","src/sync/**","src/engine.ts","src/config.ts","src/util/**","src/workorders/**","src/feedback/**","src/artifacts/**","src/metrics/**","src/mcp/**","src/cli/**"]
source_task: "9586421dd845553f"
tags: ["architecture","neo4j","doc-as-code","mcp","product-management"]
blueprint_hashes: {"SDD-001":"7499c0512bc3d4684195d17a0ec23a1ef2d4fa09e3a9d868bddff5500068e30b"}
---

## Objetivo
Sync Monitor: hashes de código y símbolos, commits con trailers Refs, baseline y reglas de drift

## Contexto
SDD-001 — Arquitectura del Product & Context Graph Engine; features: PRD-001

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-001
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-003`
