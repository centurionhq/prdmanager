---
id: "WO-035"
type: "WO"
title: "Cablear el extractor por defecto en resolveGoverned con fallback automático a Legacy por extensión"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-004"]
impacts_paths: ["packages/core/src/sync/code-refs.ts","packages/core/src/sync/symbol-extractor.ts","packages/core/src/sync/tree-sitter-extractor.ts","packages/core/src/sync/legacy-extractor.ts","packages/core/src/sync/symbol-cache.ts","packages/core/src/engine.ts","packages/core/src/index.ts","packages/core/src/scaffold/gitignore.ts",".gitignore","packages/core/package.json","packages/core/src/sync/code-refs.ts#resolveGoverned"]
source_task: "8e2e88d0f766d018"
tags: ["parser","tree-sitter","drift","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T15:28:08.236Z"
---

## Objetivo
Cablear el extractor por defecto en resolveGoverned con fallback automático a Legacy por extensión

## Contexto
SDD-004 — Extracción de símbolos con Tree-sitter; features: PRD-003

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-004
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-035`
