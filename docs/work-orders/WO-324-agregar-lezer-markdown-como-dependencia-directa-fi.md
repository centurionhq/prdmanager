---
id: "WO-324"
type: "WO"
title: "Agregar `@lezer/markdown` como dependencia directa fijada en la versión exacta ya resuelta transitivamente, y `fast-check` como dependencia de test"
status: "pending"
created_at: "2026-09-15"
implements: ["ADR-009"]
impacts_paths: ["packages/app/package.json","packages/app/tests/unit/**","packages/server/tests/learning/**","package.json","package-lock.json"]
source_task: "5acfa7726a5066d5"
tags: ["architecture-decision","editor","collab","saas"]
---

## Objetivo
Agregar `@lezer/markdown` como dependencia directa fijada en la versión exacta ya resuelta transitivamente, y `fast-check` como dependencia de test

## Contexto
ADR-009 — Vista previa editable sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-324`
