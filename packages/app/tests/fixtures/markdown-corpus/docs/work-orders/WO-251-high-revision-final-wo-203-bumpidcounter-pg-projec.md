---
id: "WO-251"
type: "WO"
title: "HIGH — revisión final WO-203: bumpIdCounter (pg-project-engine.ts) duplica a mano el mismo UPSERT GREATEST que seedIdCounterAtLeast (packages/db/src/id-counters.ts, ya usado por import-repository.ts) sourceando org_id distinto (this.orgId vs current_setting('app.org_id')); hacer que PgProjectEngine "
status: "done"
created_at: "2026-09-15"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "eef85496b404ab47"
tags: ["saas","engine","documents","workflow"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:12:55.526Z"
completed_at: "2026-09-15T10:44:12.178Z"
resolved_by: ["80a5a651bd8fed5ed03fec4c8cc22b9894312fd7"]
blueprint_hashes: {"SDD-007":"90f1c5e5fc0d68d1ab72838572230d813e01547be66463f35ae5a0504b2ac8c4"}
---

## Objetivo
HIGH — revisión final WO-203: bumpIdCounter (pg-project-engine.ts) duplica a mano el mismo UPSERT GREATEST que seedIdCounterAtLeast (packages/db/src/id-counters.ts, ya usado por import-repository.ts) sourceando org_id distinto (this.orgId vs current_setting('app.org_id')); hacer que PgProjectEngine llame a seedIdCounterAtLeast en vez de reimplementar el SQL, con test de que ambos call sites usan la misma función

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-251`
