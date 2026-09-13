---
id: "WO-024"
type: "WO"
title: "Endurecer la política de Refs tras la revisión: bypasses en CI, proyectos en subdirectorios, hooks relativos al worktree, errores de git y lista de exentos por id y hash"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "0bd345e4541bee8b"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T08:49:43.586Z"
---

## Objetivo
Endurecer la política de Refs tras la revisión: bypasses en CI, proyectos en subdirectorios, hooks relativos al worktree, errores de git y lista de exentos por id y hash

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-024`
