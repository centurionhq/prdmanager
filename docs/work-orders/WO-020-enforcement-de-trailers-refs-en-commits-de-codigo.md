---
id: "WO-020"
type: "WO"
title: "Enforcement de trailers Refs en commits de código gobernado con hook commit-msg, prdm check commits y CI"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "542b3ec3999893af"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T07:29:50.599Z"
completed_at: "2026-09-13T08:16:41.626Z"
resolved_by: ["ec1a087c394644f7acdc494c80db146536b2f55e"]
blueprint_hashes: {"SDD-002":"8a28886b5f1a3558350087873d184acbdbf2dfbccf051abae33f2863f5ada48b"}
---

## Objetivo
Enforcement de trailers Refs en commits de código gobernado con hook commit-msg, prdm check commits y CI

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-020`
