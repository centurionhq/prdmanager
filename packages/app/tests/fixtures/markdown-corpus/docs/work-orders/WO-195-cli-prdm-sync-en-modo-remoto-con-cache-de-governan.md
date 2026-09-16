---
id: "WO-195"
type: "WO"
title: "CLI prdm sync en modo remoto con caché de governance escrita por id con safe-fs, resolveGoverned y readCommits locales, OIDC adjunto en CI, envío idempotente y --check, con tests de traversal, symlink y contra servidor de test"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "c431c7758d97df20"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T01:27:43.278Z"
completed_at: "2026-09-15T01:44:04.058Z"
resolved_by: ["54b2936a9ac77d43d5c1857c1cd2b1938bbd5245"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
CLI prdm sync en modo remoto con caché de governance escrita por id con safe-fs, resolveGoverned y readCommits locales, OIDC adjunto en CI, envío idempotente y --check, con tests de traversal, symlink y contra servidor de test

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-195`
