---
id: "WO-105"
type: "WO"
title: "Invitaciones con secreto de un solo uso separado del id y enviado en el fragmento de la URL, rol de organización y grants de proyecto, aceptación por usuario nuevo o existente, expiración y revocación, con tests de id sin secreto, reuso y doble aceptación"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "f268a0c5f09236d0"
tags: ["saas","tenancy","auth","rbac","dashboard"]
---

## Objetivo
Invitaciones con secreto de un solo uso separado del id y enviado en el fragmento de la URL, rol de organización y grants de proyecto, aceptación por usuario nuevo o existente, expiración y revocación, con tests de id sin secreto, reuso y doble aceptación

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-105`
