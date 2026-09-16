---
id: "WO-390"
type: "WO"
title: "Gate: correcciones post-cierre encontradas por CI (umbral de wall-clock del presupuesto de rendimiento demasiado ajustado para el runner compartido de CI)"
status: "pending"
created_at: "2026-09-16"
implements: ["SDD-014"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/package.json","packages/collab/src/**","packages/collab/tests/**","packages/server/tests/e2e/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "fd9ec3d71e3137ff"
tags: ["editor","collab","yjs","accessibility"]
---

## Objetivo
Gate: correcciones post-cierre encontradas por CI (umbral de wall-clock del presupuesto de rendimiento demasiado ajustado para el runner compartido de CI)

## Contexto
SDD-014 — Editor de vista previa sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-014
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-390`
