---
id: "WO-382"
type: "WO"
title: "Estados de solo lectura: `readonly` de colaboración, `generated`/`archived`, sin conexión, mobile"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-014"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/package.json","packages/collab/src/**","packages/collab/tests/**","packages/server/tests/e2e/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "205f05e457eaba7c"
tags: ["editor","collab","yjs","accessibility"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T02:30:15.027Z"
completed_at: "2026-09-16T03:16:28.550Z"
resolved_by: ["f4794357fd316a95261db1f08cff53712042dce2"]
blueprint_hashes: {"SDD-014":"aa6eba6d8fecb8f4f2b1453724b6f1df520bd39267debdce18896734e6fd7291"}
---

## Objetivo
Estados de solo lectura: `readonly` de colaboración, `generated`/`archived`, sin conexión, mobile

## Contexto
SDD-014 — Editor de vista previa sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-014
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-382`
