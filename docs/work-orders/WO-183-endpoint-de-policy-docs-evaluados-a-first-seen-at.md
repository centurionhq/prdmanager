---
id: "WO-183"
type: "WO"
title: "Endpoint de policy docs evaluados a first_seen_at de cada sha en un único request, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "2feeebc692c83383"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T23:12:10.565Z"
completed_at: "2026-09-14T23:19:46.037Z"
resolved_by: ["c6b969253a8c805e459d394436ad62c12e3914f9"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
Endpoint de policy docs evaluados a first_seen_at de cada sha en un único request, con tests

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-183`
