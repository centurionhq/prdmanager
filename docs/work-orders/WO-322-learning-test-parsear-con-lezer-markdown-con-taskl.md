---
id: "WO-322"
type: "WO"
title: "Learning test: parsear con `@lezer/markdown` (con `TaskList` y `Strikethrough`) el corpus completo `docs/**/*.md` de este repositorio y verificar que los rangos `from`/`to` de cada nodo de nivel superior están ordenados, son contiguos y que `body.slice(from, to)` reproduce exactamente el bloque espe"
status: "pending"
created_at: "2026-09-15"
implements: ["ADR-009"]
impacts_paths: ["packages/app/package.json","packages/app/tests/unit/**","packages/server/tests/learning/**","package.json","package-lock.json"]
source_task: "4eef523fb61dba2f"
tags: ["architecture-decision","editor","collab","saas"]
---

## Objetivo
Learning test: parsear con `@lezer/markdown` (con `TaskList` y `Strikethrough`) el corpus completo `docs/**/*.md` de este repositorio y verificar que los rangos `from`/`to` de cada nodo de nivel superior están ordenados, son contiguos y que `body.slice(from, to)` reproduce exactamente el bloque esperado

## Contexto
ADR-009 — Vista previa editable sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-322`
