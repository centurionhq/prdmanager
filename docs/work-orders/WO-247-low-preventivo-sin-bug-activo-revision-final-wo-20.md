---
id: "WO-247"
type: "WO"
title: "LOW (preventivo, sin bug activo) — revisión final WO-203: no hay regla de lint/dependency-cruiser que fuerce la dirección de dependencias core ← mcp ← server (hoy limpia solo por disciplina, verificado por grep); agregar una regla de import boundaries que falle si core o mcp importan de db/server/ap"
status: "in_progress"
created_at: "2026-09-15"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "cf2b6c01b09b250c"
tags: ["saas","tenancy","auth","rbac","dashboard"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:12:46.730Z"
---

## Objetivo
LOW (preventivo, sin bug activo) — revisión final WO-203: no hay regla de lint/dependency-cruiser que fuerce la dirección de dependencias core ← mcp ← server (hoy limpia solo por disciplina, verificado por grep); agregar una regla de import boundaries que falle si core o mcp importan de db/server/app

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-247`
