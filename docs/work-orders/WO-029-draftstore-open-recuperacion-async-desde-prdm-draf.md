---
id: "WO-029"
type: "WO"
title: "DraftStore.open (recuperación async desde .prdm/drafts) y métodos mutadores async persistiendo con safe-fs"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-003"]
impacts_paths: ["packages/core/src/authoring/**","packages/mcp/src/server.ts","packages/core/src/scaffold/gitignore.ts",".gitignore"]
source_task: "1d26663fe913b83e"
tags: ["core","resilience","draft-store","stateless-mcp"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T14:19:20.674Z"
completed_at: "2026-09-13T14:30:53.472Z"
resolved_by: ["3c1a5afea40fc01617de2d07956df12ac868c79e"]
blueprint_hashes: {"SDD-003":"fc5140c1527b407042f0c8a48b5b74abd54beacf28dabc4c4bcc121b07bf5d14"}
---

## Objetivo
DraftStore.open (recuperación async desde .prdm/drafts) y métodos mutadores async persistiendo con safe-fs

## Contexto
SDD-003 — Persistencia stateful de borradores en @prdm/core; features: FR-001

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-003
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-029`
