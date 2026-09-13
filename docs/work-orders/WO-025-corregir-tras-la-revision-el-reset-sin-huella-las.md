---
id: "WO-025"
type: "WO"
title: "Corregir tras la revisión el reset sin huella, las lecturas sobre un grafo pendiente de recuperación, los fences de prompts, los acks de diseño por MCP y la documentación"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "aeb4cc8366deb83b"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T08:49:45.000Z"
---

## Objetivo
Corregir tras la revisión el reset sin huella, las lecturas sobre un grafo pendiente de recuperación, los fences de prompts, los acks de diseño por MCP y la documentación

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-025`
