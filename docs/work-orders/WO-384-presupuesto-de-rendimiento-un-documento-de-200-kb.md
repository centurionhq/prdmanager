---
id: "WO-384"
type: "WO"
title: "Presupuesto de rendimiento: un documento de 200 KB parsea y re-renderiza un cambio incremental en menos de 16 ms"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-014"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/package.json","packages/collab/src/**","packages/collab/tests/**","packages/server/tests/e2e/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "5b0f048e6a65e47e"
tags: ["editor","collab","yjs","accessibility"]
---

## Objetivo
Presupuesto de rendimiento: un documento de 200 KB parsea y re-renderiza un cambio incremental en menos de 16 ms

## Contexto
SDD-014 — Editor de vista previa sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-014
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-384`
