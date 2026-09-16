---
id: "WO-021"
type: "WO"
title: "Dogfooding end-to-end con aislamiento de dos proyectos y autoría conversacional hasta 0 drift"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "24eae5aea3a7e4ce"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T08:36:31.427Z"
completed_at: "2026-09-13T09:00:43.701Z"
resolved_by: ["7b1929c63e9c7ab3a5b1229bd40773735fad0232"]
blueprint_hashes: {"SDD-002":"8a28886b5f1a3558350087873d184acbdbf2dfbccf051abae33f2863f5ada48b"}
---

## Objetivo
Dogfooding end-to-end con aislamiento de dos proyectos y autoría conversacional hasta 0 drift

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-021`
