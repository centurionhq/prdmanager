---
id: "WO-186"
type: "WO"
title: "claim_work_order remoto con assignee ligado al handle del token y claimed_by_user_id, y complete_work_order con sha obligatorio verificado contra commits baseline, con tests"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "804c3f01ae50ccde"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
---

## Objetivo
claim_work_order remoto con assignee ligado al handle del token y claimed_by_user_id, y complete_work_order con sha obligatorio verificado contra commits baseline, con tests

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-186`
