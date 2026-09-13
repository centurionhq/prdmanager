---
id: "WO-014"
type: "WO"
title: "Comando prdm init con estructura de carpetas, .prdm.yaml, registro del proyecto, templates y hooks idempotentes"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "95e8d8e2b125612b"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
---

## Objetivo
Comando prdm init con estructura de carpetas, .prdm.yaml, registro del proyecto, templates y hooks idempotentes

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-014`
