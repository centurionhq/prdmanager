---
id: "WO-125"
type: "WO"
title: "EngineOps.readCommit y ProjectEngine.scan reemplazando la lectura directa de git y de config.root en workorders/lifecycle.ts, lifecycle/close.ts y mcp tools-authoring.ts, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "3403c731e2e224bb"
tags: ["saas","engine","documents","workflow"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T07:32:53.495Z"
completed_at: "2026-09-14T07:39:18.487Z"
resolved_by: ["d73ba644e12d54d5a0df6d334934e29d6355b9f8"]
blueprint_hashes: {"SDD-007":"90f1c5e5fc0d68d1ab72838572230d813e01547be66463f35ae5a0504b2ac8c4"}
---

## Objetivo
EngineOps.readCommit y ProjectEngine.scan reemplazando la lectura directa de git y de config.root en workorders/lifecycle.ts, lifecycle/close.ts y mcp tools-authoring.ts, con tests

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-125`
