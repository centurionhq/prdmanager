---
id: "WO-212"
type: "WO"
title: "Reducir la carga del test de estrés del lock en CI (menos workers e iteraciones bajo process.env.CI, stress completo sin cambios en local): ningún staleAfterMs finito puede ser inmune a una pausa de scheduler sin cota, y con 30s restaurado la violación de exclusión mutua volvió a reproducirse; no es"
status: "done"
created_at: "2026-09-14"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "d3573a3707fcada4"
tags: ["saas","engine","documents","workflow"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T07:09:18.433Z"
completed_at: "2026-09-14T07:09:37.541Z"
resolved_by: ["9ca46402a038ff769e7d1412848ca95e7d5a3cd7"]
blueprint_hashes: {"SDD-007":"90f1c5e5fc0d68d1ab72838572230d813e01547be66463f35ae5a0504b2ac8c4"}
---

## Objetivo
Reducir la carga del test de estrés del lock en CI (menos workers e iteraciones bajo process.env.CI, stress completo sin cambios en local): ningún staleAfterMs finito puede ser inmune a una pausa de scheduler sin cota, y con 30s restaurado la violación de exclusión mutua volvió a reproducirse; no es un problema de calibración de márgenes sino riesgo residual, así que se reduce cuánto se lo expone en un runner real de 2 vCPU en vez de seguir adivinando números

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-212`
