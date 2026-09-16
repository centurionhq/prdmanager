---
id: "WO-239"
type: "WO"
title: "Implementar PRDM_TOKEN en CI: sync.ts, commit-msg.ts y check-range.ts solo leen credenciales del archivo local, así que CI (sin ese archivo) nunca puede autenticarse a pesar de que el SDD y server-origin.ts ya asumen PRDM_TOKEN; agregar resolveRemoteCredential (obligatorio en CI, igual que PRDM_SERV"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "78553fac424c1aa0"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T04:17:42.611Z"
completed_at: "2026-09-15T04:26:15.111Z"
resolved_by: ["608981a248d9aab6ade6641b2c3ecc0d53989cba"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
Implementar PRDM_TOKEN en CI: sync.ts, commit-msg.ts y check-range.ts solo leen credenciales del archivo local, así que CI (sin ese archivo) nunca puede autenticarse a pesar de que el SDD y server-origin.ts ya asumen PRDM_TOKEN; agregar resolveRemoteCredential (obligatorio en CI, igual que PRDM_SERVER en server-origin.ts) y usarlo en los tres call sites, con test

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-239`
