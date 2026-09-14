---
id: "WO-213"
type: "WO"
title: "Corregir el fake GraphStore de project-engine.test.ts (WO-124), que usaba links en vez de edges en Subgraph y no tipaba contra la interfaz real, rompiendo el typecheck de CI"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "8f44497710f8add0"
tags: ["saas","engine","documents","workflow"]
---

## Objetivo
Corregir el fake GraphStore de project-engine.test.ts (WO-124), que usaba links en vez de edges en Subgraph y no tipaba contra la interfaz real, rompiendo el typecheck de CI

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-213`
