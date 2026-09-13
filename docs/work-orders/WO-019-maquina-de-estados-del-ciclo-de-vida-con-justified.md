---
id: "WO-019"
type: "WO"
title: "Máquina de estados del ciclo de vida con JUSTIFIED_BY y cierre con prdm close"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "66321f6acea6b446"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
---

## Objetivo
Máquina de estados del ciclo de vida con JUSTIFIED_BY y cierre con prdm close

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-019`
