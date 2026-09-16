---
id: "WO-392"
type: "WO"
title: "Gate post-cierre de WO-391: sacar del README el callout \"Limitación conocida (FB-009)\", ya resuelto"
status: "done"
created_at: "2026-09-16"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "33de67f15f72a568"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T12:52:09.843Z"
completed_at: "2026-09-16T12:52:34.109Z"
resolved_by: ["27221a7893284f7ab6e0e6f6eadeb75f91b43a8b"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
Gate post-cierre de WO-391: sacar del README el callout "Limitación conocida (FB-009)", ya resuelto

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-392`
