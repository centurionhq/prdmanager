---
id: "WO-242"
type: "WO"
title: "packages/server/tests/collab/live-validation.test.ts falla en el job integration-tests real (nunca localmente) con \"deadlock detected\" de Postgres dentro de truncateAll (packages/testkit/src/pg.ts); diagnosticar la causa real (conexiones de pool no liberadas antes del truncate bajo el runner más len"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "77fb6ba48fef9084"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T07:26:56.240Z"
completed_at: "2026-09-15T07:34:25.628Z"
resolved_by: ["2577a4183189d915d9cbae9f40d1e5c2020d5870"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
packages/server/tests/collab/live-validation.test.ts falla en el job integration-tests real (nunca localmente) con "deadlock detected" de Postgres dentro de truncateAll (packages/testkit/src/pg.ts); diagnosticar la causa real (conexiones de pool no liberadas antes del truncate bajo el runner más lento, orden de locks entre tablas, o similar) con evidencia concreta, no reintentos ni ampliar timeouts a ciegas

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-242`
