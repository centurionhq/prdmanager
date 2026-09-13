---
id: "WO-025"
type: "WO"
title: "Corregir tras la revisión el reset sin huella, las lecturas sobre un grafo pendiente de recuperación, los fences de prompts, los acks de diseño por MCP y la documentación"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "aeb4cc8366deb83b"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T08:49:45.000Z"
completed_at: "2026-09-13T09:33:33.618Z"
resolved_by: ["7342e276760b974438601878de9ee9e40fa6cbd5"]
blueprint_hashes: {"SDD-002":"8a28886b5f1a3558350087873d184acbdbf2dfbccf051abae33f2863f5ada48b"}
---

## Objetivo
Corregir tras la revisión el reset sin huella, las lecturas sobre un grafo pendiente de recuperación, los fences de prompts, los acks de diseño por MCP y la documentación

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-025`
