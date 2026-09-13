---
id: "WO-027"
type: "WO"
title: "Evaluar la política de Refs en rangos históricos con el estado de cada WO al momento del commit, sin enforcement cuando la base no tiene .prdm.yaml y eximiendo solo la historia hasta enforce_refs_since"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "c66150af99b6215a"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T09:38:34.081Z"
---

## Objetivo
Evaluar la política de Refs en rangos históricos con el estado de cada WO al momento del commit, sin enforcement cuando la base no tiene .prdm.yaml y eximiendo solo la historia hasta enforce_refs_since

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-027`
