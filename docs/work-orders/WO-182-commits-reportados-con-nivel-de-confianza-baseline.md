---
id: "WO-182"
type: "WO"
title: "Commits reportados con nivel de confianza baseline o preview, first_seen_at y precedencia de baseline, con tests de commit falsificado por developer"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "7f2c6767f7060310"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
---

## Objetivo
Commits reportados con nivel de confianza baseline o preview, first_seen_at y precedencia de baseline, con tests de commit falsificado por developer

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-182`
