---
id: "WO-132"
type: "WO"
title: "PgProjectEngine con scan, escrituras de documentos y transacción con pg_advisory_xact_lock por proyecto, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "76d870d370b80376"
tags: ["saas","engine","documents","workflow"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T08:39:35.528Z"
completed_at: "2026-09-14T08:49:41.718Z"
resolved_by: ["506f59d135948e5144113a4d67ee13d1d8ae172d"]
blueprint_hashes: {"SDD-007":"90f1c5e5fc0d68d1ab72838572230d813e01547be66463f35ae5a0504b2ac8c4"}
---

## Objetivo
PgProjectEngine con scan, escrituras de documentos y transacción con pg_advisory_xact_lock por proyecto, con tests

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-132`
