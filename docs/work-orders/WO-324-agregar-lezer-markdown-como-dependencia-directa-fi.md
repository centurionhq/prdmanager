---
id: "WO-324"
type: "WO"
title: "Agregar `@lezer/markdown` como dependencia directa fijada en la versión exacta ya resuelta transitivamente, y `fast-check` como dependencia de test"
status: "done"
created_at: "2026-09-15"
implements: ["ADR-009"]
impacts_paths: ["packages/app/package.json","packages/app/tests/unit/**","packages/server/tests/learning/**","package.json","package-lock.json"]
source_task: "5acfa7726a5066d5"
tags: ["architecture-decision","editor","collab","saas"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T21:02:13.324Z"
completed_at: "2026-09-15T21:29:35.072Z"
resolved_by: ["ea7daabc6181641e8975f93deb8a8a2bdf751222"]
blueprint_hashes: {"ADR-009":"ba3e91135c9f4b5008eba2fbeacc83a8da9355b6a8f3b08aa31cbb39a56a6ee8"}
---

## Objetivo
Agregar `@lezer/markdown` como dependencia directa fijada en la versión exacta ya resuelta transitivamente, y `fast-check` como dependencia de test

## Contexto
ADR-009 — Vista previa editable sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-324`
