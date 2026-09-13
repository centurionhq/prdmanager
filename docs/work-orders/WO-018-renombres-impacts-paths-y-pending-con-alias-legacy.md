---
id: "WO-018"
type: "WO"
title: "Renombres impacts_paths y pending con alias legacy, content hash v2, baseline v2 y prdm migrate docs"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-002"]
governs: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "df72423e4f2e1cd5"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T06:45:55.313Z"
---

## Objetivo
Renombres impacts_paths y pending con alias legacy, content hash v2, baseline v2 y prdm migrate docs

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-018`
