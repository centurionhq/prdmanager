---
id: "WO-136"
type: "WO"
title: "Flujo de estados draft, in_review, published y archived con permisos y reglas de archivado, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "498e06beb9e3b73b"
tags: ["saas","engine","documents","workflow"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T09:16:32.092Z"
completed_at: "2026-09-14T09:28:18.943Z"
resolved_by: ["7917fe59718cf12b44999f3e6553bd2311a78930"]
blueprint_hashes: {"SDD-007":"90f1c5e5fc0d68d1ab72838572230d813e01547be66463f35ae5a0504b2ac8c4"}
---

## Objetivo
Flujo de estados draft, in_review, published y archived con permisos y reglas de archivado, con tests

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-136`
