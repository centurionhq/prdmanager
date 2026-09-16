---
id: "WO-204"
type: "WO"
title: "Dogfooding con sync --check en 0 y cobertura de 80% o más"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "0a76fcf95f074e58"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T09:33:26.995Z"
completed_at: "2026-09-15T09:34:34.195Z"
resolved_by: ["376e9c2e084967070f3bdd54ee2021b88296944c"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
Dogfooding con sync --check en 0 y cobertura de 80% o más

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-204`
