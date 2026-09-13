---
id: "WO-109"
type: "WO"
title: "Tokens personales y de CI con prefijo con checksum, sha256, expiración obligatoria de hasta 90 días, revocación y last_used_at, y plugin Bearer separado del de sesión, con tests"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "0e48052f84f6ee25"
tags: ["saas","tenancy","auth","rbac","dashboard"]
---

## Objetivo
Tokens personales y de CI con prefijo con checksum, sha256, expiración obligatoria de hasta 90 días, revocación y last_used_at, y plugin Bearer separado del de sesión, con tests

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-109`
