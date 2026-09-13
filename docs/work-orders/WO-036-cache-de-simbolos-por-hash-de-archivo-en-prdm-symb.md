---
id: "WO-036"
type: "WO"
title: "Caché de símbolos por hash de archivo en .prdm/symbol-cache.json, agnóstica al extractor"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-004"]
impacts_paths: ["packages/core/src/sync/code-refs.ts","packages/core/src/sync/symbol-extractor.ts","packages/core/src/sync/tree-sitter-extractor.ts","packages/core/src/sync/legacy-extractor.ts","packages/core/src/sync/symbol-cache.ts","packages/core/src/engine.ts","packages/core/src/index.ts","packages/core/src/scaffold/gitignore.ts",".gitignore","packages/core/package.json","packages/core/src/sync/code-refs.ts#resolveGoverned"]
source_task: "461d7106c59bf9e3"
tags: ["parser","tree-sitter","drift","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T15:28:09.699Z"
---

## Objetivo
Caché de símbolos por hash de archivo en .prdm/symbol-cache.json, agnóstica al extractor

## Contexto
SDD-004 — Extracción de símbolos con Tree-sitter; features: PRD-003

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-004
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-036`
