---
id: "WO-375"
type: "WO"
title: "`y-binding.ts` y el `Y.UndoManager` compartido movido al contexto de colaboración; test de convergencia de dos `Y.Doc` y test de integración con Hocuspocus real (la actualización se envía, el blame atribuye al usuario)"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-014"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/package.json","packages/collab/src/**","packages/collab/tests/**","packages/server/tests/e2e/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "ee0f8c577880f780"
tags: ["editor","collab","yjs","accessibility"]
---

## Objetivo
`y-binding.ts` y el `Y.UndoManager` compartido movido al contexto de colaboración; test de convergencia de dos `Y.Doc` y test de integración con Hocuspocus real (la actualización se envía, el blame atribuye al usuario)

## Contexto
SDD-014 — Editor de vista previa sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-014
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-375`
