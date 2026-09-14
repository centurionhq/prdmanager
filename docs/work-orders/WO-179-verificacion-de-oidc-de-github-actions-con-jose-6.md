---
id: "WO-179"
type: "WO"
title: "Verificación de OIDC de GitHub Actions con jose 6.2.12 (JWKS, iss, alg, tiempos, jti de un solo uso, audiencia, repository_id y owner id, ref de la rama por defecto, event push y sha) inyectable en buildServer, con tests con JWKS de prueba"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "8e5f3f0b488bb144"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T22:35:03.234Z"
completed_at: "2026-09-14T22:39:33.958Z"
resolved_by: ["0bebdcd71b9d3fed88dabe93ce28169156f31a6b"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
Verificación de OIDC de GitHub Actions con jose 6.2.12 (JWKS, iss, alg, tiempos, jti de un solo uso, audiencia, repository_id y owner id, ref de la rama por defecto, event push y sha) inyectable en buildServer, con tests con JWKS de prueba

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-179`
