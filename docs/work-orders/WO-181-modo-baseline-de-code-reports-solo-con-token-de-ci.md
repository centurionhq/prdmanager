---
id: "WO-181"
type: "WO"
title: "Modo baseline de code-reports solo con token de CI, OIDC verificado, head que no retrocede con override de admin auditado y hash_algo_version coincidente, con tests de rama falsificada, token de feature branch y force-push"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "6c64a978fd0328bb"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T22:50:20.392Z"
completed_at: "2026-09-14T23:03:56.311Z"
resolved_by: ["8ab1e55a6c6e28b1265d61d492009efdcc58e3a2"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
Modo baseline de code-reports solo con token de CI, OIDC verificado, head que no retrocede con override de admin auditado y hash_algo_version coincidente, con tests de rama falsificada, token de feature branch y force-push

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-181`
