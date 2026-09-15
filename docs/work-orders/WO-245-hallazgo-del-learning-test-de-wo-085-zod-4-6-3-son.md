---
id: "WO-245"
type: "WO"
title: "Hallazgo del learning test de WO-085: zod 4.6.3 sondea `new Function('')` para decidir si compila validadores rápidos, y ese sondeo dispara una violación real de `script-src` (sin `unsafe-eval`) aunque el throw quede atrapado — deshabilitar el sondeo con `config({ jitless: true })` al inicio de `pac"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "6775eea8ab5921d0"
tags: ["saas","tenancy","auth","rbac","dashboard"]
---

## Objetivo
Hallazgo del learning test de WO-085: zod 4.6.3 sondea `new Function('')` para decidir si compila validadores rápidos, y ese sondeo dispara una violación real de `script-src` (sin `unsafe-eval`) aunque el throw quede atrapado — deshabilitar el sondeo con `config({ jitless: true })` al inicio de `packages/app/src/main.tsx`, antes de cualquier import que pueda validar con zod, con test

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-245`
