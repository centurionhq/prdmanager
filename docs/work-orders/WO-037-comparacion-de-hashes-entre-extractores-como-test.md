---
id: "WO-037"
type: "WO"
title: "Comparación de hashes entre extractores como test ejecutable y documentación del plan de re-baseline para símbolos futuros"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-004"]
impacts_paths: ["packages/core/src/sync/code-refs.ts","packages/core/src/sync/symbol-extractor.ts","packages/core/src/sync/tree-sitter-extractor.ts","packages/core/src/sync/legacy-extractor.ts","packages/core/src/sync/symbol-cache.ts","packages/core/src/engine.ts","packages/core/src/index.ts","packages/core/src/scaffold/gitignore.ts",".gitignore","packages/core/package.json","packages/core/src/sync/code-refs.ts#resolveGoverned"]
source_task: "e22f3067d63fabd5"
tags: ["parser","tree-sitter","drift","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T15:28:11.154Z"
completed_at: "2026-09-13T15:31:07.908Z"
resolved_by: ["c2002e5f026e188a8df847d22db18e4ee071d264"]
blueprint_hashes: {"SDD-004":"0bd01301602a94fa03d5ebb3cd988190220267efb1b8f417e0f87ef499c74041"}
---

## Objetivo
Comparación de hashes entre extractores como test ejecutable y documentación del plan de re-baseline para símbolos futuros

## Contexto
SDD-004 — Extracción de símbolos con Tree-sitter; features: PRD-003

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-004
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-037`
