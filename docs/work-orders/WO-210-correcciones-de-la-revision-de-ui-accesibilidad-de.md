---
id: "WO-210"
type: "WO"
title: "Correcciones de la revisión de UI/accesibilidad de la Fase 3: manejo de foco en cambios de paso o confirmación (2FA, reseteo de contraseña, aceptar invitación), aria-describedby en pistas y errores de formularios, envoltorio con scroll horizontal en tablas, y document.title por ruta, con tests"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "2483af6871c29f61"
tags: ["saas","tenancy","auth","rbac","dashboard"]
---

## Objetivo
Correcciones de la revisión de UI/accesibilidad de la Fase 3: manejo de foco en cambios de paso o confirmación (2FA, reseteo de contraseña, aceptar invitación), aria-describedby en pistas y errores de formularios, envoltorio con scroll horizontal en tablas, y document.title por ruta, con tests

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-210`
