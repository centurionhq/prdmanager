---
id: "WO-016"
type: "WO"
title: "Monorepo con npm workspaces para @prdm/core, @prdm/cli y @prdm/mcp, y cobertura compartida entre blueprints"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "d1792d86be69e450"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T06:18:51.292Z"
completed_at: "2026-09-13T06:43:22.569Z"
resolved_by: ["78bd89528303c5fdbc97cfad8d00489e728302e0"]
blueprint_hashes: {"SDD-002":"8a28886b5f1a3558350087873d184acbdbf2dfbccf051abae33f2863f5ada48b"}
---

## Objetivo
Monorepo con npm workspaces para @prdm/core, @prdm/cli y @prdm/mcp, y cobertura compartida entre blueprints

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-016`
