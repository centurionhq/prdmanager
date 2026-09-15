---
id: "WO-322"
type: "WO"
title: "Learning test: parsear con `@lezer/markdown` (con `TaskList` y `Strikethrough`) el corpus completo `docs/**/*.md` de este repositorio y verificar que los rangos `from`/`to` de cada nodo de nivel superior están ordenados, son contiguos y que `body.slice(from, to)` reproduce exactamente el bloque espe"
status: "done"
created_at: "2026-09-15"
implements: ["ADR-009"]
impacts_paths: ["packages/app/package.json","packages/app/tests/unit/**","packages/server/tests/learning/**","package.json","package-lock.json"]
source_task: "4eef523fb61dba2f"
tags: ["architecture-decision","editor","collab","saas"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T21:02:04.108Z"
completed_at: "2026-09-15T21:29:24.047Z"
resolved_by: ["e4de2e93758d448f12a2655007da5767ca0d43d1"]
blueprint_hashes: {"ADR-009":"ba3e91135c9f4b5008eba2fbeacc83a8da9355b6a8f3b08aa31cbb39a56a6ee8"}
---

## Objetivo
Learning test: parsear con `@lezer/markdown` (con `TaskList` y `Strikethrough`) el corpus completo `docs/**/*.md` de este repositorio y verificar que los rangos `from`/`to` de cada nodo de nivel superior están ordenados, son contiguos y que `body.slice(from, to)` reproduce exactamente el bloque esperado

## Contexto
ADR-009 — Vista previa editable sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-322`
