---
id: "WO-202"
type: "WO"
title: "Guía en README de login, link, import, mcp-proxy, hooks y workflow de GitHub Actions con permisos id-token, PRDM_SERVER, PRDM_TOKEN en un Environment de la rama por defecto y sin pull_request_target"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "2e19b5fb9493e643"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T04:28:03.294Z"
completed_at: "2026-09-15T04:28:26.654Z"
resolved_by: ["6eb7b74409c35db1d7b8d0e2611d391835ec3889"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
Guía en README de login, link, import, mcp-proxy, hooks y workflow de GitHub Actions con permisos id-token, PRDM_SERVER, PRDM_TOKEN en un Environment de la rama por defecto y sin pull_request_target

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-202`
