---
id: "WO-021"
type: "WO"
title: "Dogfooding end-to-end con aislamiento de dos proyectos y autoría conversacional hasta 0 drift"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "24eae5aea3a7e4ce"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
---

## Objetivo
Dogfooding end-to-end con aislamiento de dos proyectos y autoría conversacional hasta 0 drift

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-021`
