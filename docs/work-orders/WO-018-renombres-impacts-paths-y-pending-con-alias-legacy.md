---
id: "WO-018"
type: "WO"
title: "Renombres impacts_paths y pending con alias legacy, content hash v2, baseline v2 y prdm migrate docs"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "df72423e4f2e1cd5"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T06:45:55.313Z"
completed_at: "2026-09-13T07:28:34.705Z"
resolved_by: ["b753bd281f3a1ccf95d3266de8653f4ac3e1ee84"]
blueprint_hashes: {"SDD-002":"8a28886b5f1a3558350087873d184acbdbf2dfbccf051abae33f2863f5ada48b"}
---

## Objetivo
Renombres impacts_paths y pending con alias legacy, content hash v2, baseline v2 y prdm migrate docs

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-018`
