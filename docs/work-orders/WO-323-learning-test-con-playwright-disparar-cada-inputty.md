---
id: "WO-323"
type: "WO"
title: "Learning test con Playwright: disparar cada `inputType` relevante de `beforeinput` (inserción, borrado, con y sin composición IME) en Chromium y Firefox sobre un `contentEditable` con `preventDefault` incondicional, y confirmar que el DOM permanece sin mutar en todos los casos"
status: "pending"
created_at: "2026-09-15"
implements: ["ADR-009"]
impacts_paths: ["packages/app/package.json","packages/app/tests/unit/**","packages/server/tests/learning/**","package.json","package-lock.json"]
source_task: "f8423a2ae12c9f33"
tags: ["architecture-decision","editor","collab","saas"]
---

## Objetivo
Learning test con Playwright: disparar cada `inputType` relevante de `beforeinput` (inserción, borrado, con y sin composición IME) en Chromium y Firefox sobre un `contentEditable` con `preventDefault` incondicional, y confirmar que el DOM permanece sin mutar en todos los casos

## Contexto
ADR-009 — Vista previa editable sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-323`
