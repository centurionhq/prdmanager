---
id: "WO-033"
type: "WO"
title: "SymbolExtractor y LegacySymbolExtractor: mover la heurística actual detrás de la interfaz sin cambiar ningún test existente"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-004"]
impacts_paths: ["packages/core/src/sync/code-refs.ts","packages/core/src/sync/symbol-extractor.ts","packages/core/src/sync/tree-sitter-extractor.ts","packages/core/src/sync/legacy-extractor.ts","packages/core/src/sync/symbol-cache.ts","packages/core/src/engine.ts","packages/core/src/index.ts","packages/core/src/scaffold/gitignore.ts",".gitignore","packages/core/package.json","packages/core/src/sync/code-refs.ts#resolveGoverned"]
source_task: "d828d9e547078abf"
tags: ["parser","tree-sitter","drift","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T15:28:05.187Z"
completed_at: "2026-09-13T15:31:01.968Z"
resolved_by: ["c2002e5f026e188a8df847d22db18e4ee071d264"]
blueprint_hashes: {"SDD-004":"0bd01301602a94fa03d5ebb3cd988190220267efb1b8f417e0f87ef499c74041"}
---

## Objetivo
SymbolExtractor y LegacySymbolExtractor: mover la heurística actual detrás de la interfaz sin cambiar ningún test existente

## Contexto
SDD-004 — Extracción de símbolos con Tree-sitter; features: PRD-003

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-004
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-033`
