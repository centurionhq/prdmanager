---
id: "WO-121"
type: "WO"
title: "Dockerfile multi-etapa del servidor con node 24.21.0 slim fijado por digest, usuario no root, healthcheck, contexto en la raíz y Dockerfile.dockerignore"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "7a331c1b9ac83ad2"
tags: ["saas","tenancy","auth","rbac","dashboard"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T06:16:30.095Z"
completed_at: "2026-09-14T06:22:36.986Z"
resolved_by: ["e667de609e2a2240d60b66216eafa291fb658dc8"]
blueprint_hashes: {"SDD-006":"91cccdb3cd90181cfcb9b66af72f0851afe979cb7abc5b1ec374b20658ff0ca4"}
---

## Objetivo
Dockerfile multi-etapa del servidor con node 24.21.0 slim fijado por digest, usuario no root, healthcheck, contexto en la raíz y Dockerfile.dockerignore

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-121`
