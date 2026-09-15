---
id: "WO-249"
type: "WO"
title: "LOW — revisión final WO-203: governance.ts, policy-docs.ts, code-reports.ts e import.ts (todas de la misma fase SDD-010) no repiten el chequeo de Origin de defensa en profundidad que sí tiene mcp-remote.ts, aunque las rutas Bearer ya son inmunes a CSRF por rechazar cookies; agregar el mismo chequeo "
status: "in_progress"
created_at: "2026-09-15"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "103da606c1a5f683"
tags: ["saas","tenancy","auth","rbac","dashboard"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:12:51.190Z"
---

## Objetivo
LOW — revisión final WO-203: governance.ts, policy-docs.ts, code-reports.ts e import.ts (todas de la misma fase SDD-010) no repiten el chequeo de Origin de defensa en profundidad que sí tiene mcp-remote.ts, aunque las rutas Bearer ya son inmunes a CSRF por rechazar cookies; agregar el mismo chequeo por consistencia de hardening entre rutas hermanas

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-249`
