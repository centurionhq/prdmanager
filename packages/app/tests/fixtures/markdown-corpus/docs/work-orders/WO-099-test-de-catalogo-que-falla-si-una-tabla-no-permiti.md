---
id: "WO-099"
type: "WO"
title: "Test de catálogo que falla si una tabla no permitida carece de org_id, RLS forzado o FK compuesta, o si prdm_app puede asumir prdm_owner o escribir platform_admins"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "a64b2eddfaa59703"
tags: ["saas","tenancy","auth","rbac","dashboard"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T01:12:54.920Z"
completed_at: "2026-09-14T01:14:15.811Z"
resolved_by: ["af5ef5c36558ec7d25075c71af839fa988e565a4"]
blueprint_hashes: {"SDD-006":"91cccdb3cd90181cfcb9b66af72f0851afe979cb7abc5b1ec374b20658ff0ca4"}
---

## Objetivo
Test de catálogo que falla si una tabla no permitida carece de org_id, RLS forzado o FK compuesta, o si prdm_app puede asumir prdm_owner o escribir platform_admins

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-099`
