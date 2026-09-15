---
id: "WO-248"
type: "WO"
title: "LOW (preventivo) — revisión final WO-203: REDACT_PATHS (logging.ts) usa wildcards de un solo nivel (`*.token`, `*.secret`, etc.), que fast-redact no aplica recursivamente a profundidad arbitraria; un secreto anidado en un `err.cause.config...` no quedaría cubierto. Hoy no existe ningún error con `ca"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "afbba99bfafe5a45"
tags: ["saas","tenancy","auth","rbac","dashboard"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:12:48.954Z"
completed_at: "2026-09-15T10:48:38.474Z"
resolved_by: ["10583759eeab661cc57e79f4c0e7dcd129dd7b26"]
blueprint_hashes: {"SDD-006":"91cccdb3cd90181cfcb9b66af72f0851afe979cb7abc5b1ec374b20658ff0ca4"}
---

## Objetivo
LOW (preventivo) — revisión final WO-203: REDACT_PATHS (logging.ts) usa wildcards de un solo nivel (`*.token`, `*.secret`, etc.), que fast-redact no aplica recursivamente a profundidad arbitraria; un secreto anidado en un `err.cause.config...` no quedaría cubierto. Hoy no existe ningún error con `cause` envuelto en el código (verificado), así que no hay fuga activa, pero es una fragilidad estructural para código futuro — documentar el límite conocido o migrar a una redacción recursiva

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-248`
