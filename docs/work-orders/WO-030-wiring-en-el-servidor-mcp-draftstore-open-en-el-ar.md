---
id: "WO-030"
type: "WO"
title: "Wiring en el servidor MCP: DraftStore.open en el arranque y log de borradores recuperados"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-003"]
impacts_paths: ["packages/core/src/authoring/**","packages/mcp/src/server.ts","packages/core/src/scaffold/gitignore.ts",".gitignore"]
source_task: "04ea26aaa76f9d9c"
tags: ["core","resilience","draft-store","stateless-mcp"]
---

## Objetivo
Wiring en el servidor MCP: DraftStore.open en el arranque y log de borradores recuperados

## Contexto
SDD-003 — Persistencia stateful de borradores en @prdm/core; features: FR-001

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-003
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-030`
