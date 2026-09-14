---
id: "WO-133"
type: "WO"
title: "Proyección al grafo con outbox graph_version y graph_dirty tras el commit, una sola writeSnapshot por transacción y re-proyección en recover, con test que cuenta proyecciones"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "e75a72e2e2deec22"
tags: ["saas","engine","documents","workflow"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T08:50:11.593Z"
---

## Objetivo
Proyección al grafo con outbox graph_version y graph_dirty tras el commit, una sola writeSnapshot por transacción y re-proyección en recover, con test que cuenta proyecciones

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-133`
