---
id: "WO-039"
type: "WO"
title: "Confirmar en package.json de packages/core las versiones exactas web-tree-sitter 0.25.10 y tree-sitter-wasms 0.1.13, y agregar el cache de símbolos a .gitignore"
status: "in_progress"
created_at: "2026-09-13"
implements: ["ADR-003"]
impacts_paths: ["packages/core/package.json",".gitignore"]
source_task: "7075dead336f7b87"
tags: ["architecture-decision","tree-sitter","wasm","parser"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T15:28:14.181Z"
---

## Objetivo
Confirmar en package.json de packages/core las versiones exactas web-tree-sitter 0.25.10 y tree-sitter-wasms 0.1.13, y agregar el cache de símbolos a .gitignore

## Contexto
ADR-003 — Runtime y grammars WASM para Tree-sitter; features: PRD-003

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-003
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-039`
