---
id: "WO-240"
type: "WO"
title: "La ruta nueva del dashboard de drift (WO-199, GET .../drift/reports) quedó sin su entrada en la suite de aislamiento (WO-111); descubierto porque el job de CI sync-check solo corre npm run test:unit, que no incluye packages/server/tests/isolation/ — agregar el probe y verificar los casos cross-org/c"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "9b0bb420c8254327"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T05:10:48.046Z"
completed_at: "2026-09-15T05:11:10.133Z"
resolved_by: ["60573e601f1cd28cec032d29251234042e64f698"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
La ruta nueva del dashboard de drift (WO-199, GET .../drift/reports) quedó sin su entrada en la suite de aislamiento (WO-111); descubierto porque el job de CI sync-check solo corre npm run test:unit, que no incluye packages/server/tests/isolation/ — agregar el probe y verificar los casos cross-org/cross-project

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-240`
