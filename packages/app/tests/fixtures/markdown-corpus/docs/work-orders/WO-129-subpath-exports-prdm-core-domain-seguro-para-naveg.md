---
id: "WO-129"
type: "WO"
title: "Subpath exports @prdm/core/domain seguro para navegador y @prdm/mcp/lib con fenceTag y escapeFenceChars sin ejecutar main al importar, alias de subpath en vitest.config.ts y guard tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "8c64923f05f9da8d"
tags: ["saas","engine","documents","workflow"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T07:53:21.966Z"
completed_at: "2026-09-14T07:58:49.715Z"
resolved_by: ["c9eca83bcd0395967d410d99a032d7431795ba5b"]
blueprint_hashes: {"SDD-007":"90f1c5e5fc0d68d1ab72838572230d813e01547be66463f35ae5a0504b2ac8c4"}
---

## Objetivo
Subpath exports @prdm/core/domain seguro para navegador y @prdm/mcp/lib con fenceTag y escapeFenceChars sin ejecutar main al importar, alias de subpath en vitest.config.ts y guard tests

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-129`
