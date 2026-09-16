---
id: "WO-390"
type: "WO"
title: "Gate: correcciones post-cierre encontradas por CI (umbral de wall-clock del presupuesto de rendimiento demasiado ajustado para el runner compartido de CI)"
status: "done"
created_at: "2026-09-16"
implements: ["SDD-014"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/package.json","packages/collab/src/**","packages/collab/tests/**","packages/server/tests/e2e/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "fd9ec3d71e3137ff"
tags: ["editor","collab","yjs","accessibility"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T11:54:07.375Z"
completed_at: "2026-09-16T11:54:34.102Z"
resolved_by: ["db68e8c20a66d0b5ed39d406d76d73deb1e2fb96"]
blueprint_hashes: {"SDD-014":"aa6eba6d8fecb8f4f2b1453724b6f1df520bd39267debdce18896734e6fd7291"}
---

## Objetivo
Gate: correcciones post-cierre encontradas por CI (umbral de wall-clock del presupuesto de rendimiento demasiado ajustado para el runner compartido de CI)

## Contexto
SDD-014 — Editor de vista previa sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-014
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-390`
