---
id: "WO-029"
type: "WO"
title: "DraftStore.open (recuperación async desde .prdm/drafts) y métodos mutadores async persistiendo con safe-fs"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-003"]
impacts_paths: ["packages/core/src/authoring/**","packages/mcp/src/server.ts","packages/core/src/scaffold/gitignore.ts",".gitignore"]
source_task: "1d26663fe913b83e"
tags: ["core","resilience","draft-store","stateless-mcp"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T14:19:20.674Z"
---

## Objetivo
DraftStore.open (recuperación async desde .prdm/drafts) y métodos mutadores async persistiendo con safe-fs

## Contexto
SDD-003 — Persistencia stateful de borradores en @prdm/core; features: FR-001

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-003
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-029`
