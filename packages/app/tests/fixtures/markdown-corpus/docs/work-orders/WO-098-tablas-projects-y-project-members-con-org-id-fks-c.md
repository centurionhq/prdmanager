---
id: "WO-098"
type: "WO"
title: "Tablas projects y project_members con org_id, FKs compuestas, políticas RLS forzadas con NULLIF y withTenantTx que fija app.org_id, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "5d62e6f3d6a9a43b"
tags: ["saas","tenancy","auth","rbac","dashboard"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T00:59:00.321Z"
completed_at: "2026-09-14T01:03:05.501Z"
resolved_by: ["05e94d6d76b1fd5ec6c66aa858a1209756c9683f"]
blueprint_hashes: {"SDD-006":"91cccdb3cd90181cfcb9b66af72f0851afe979cb7abc5b1ec374b20658ff0ca4"}
---

## Objetivo
Tablas projects y project_members con org_id, FKs compuestas, políticas RLS forzadas con NULLIF y withTenantTx que fija app.org_id, con tests

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-098`
