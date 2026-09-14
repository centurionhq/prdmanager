---
id: "WO-132"
type: "WO"
title: "PgProjectEngine con scan, escrituras de documentos y transacción con pg_advisory_xact_lock por proyecto, con tests"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "76d870d370b80376"
tags: ["saas","engine","documents","workflow"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T08:39:35.528Z"
---

## Objetivo
PgProjectEngine con scan, escrituras de documentos y transacción con pg_advisory_xact_lock por proyecto, con tests

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-132`
