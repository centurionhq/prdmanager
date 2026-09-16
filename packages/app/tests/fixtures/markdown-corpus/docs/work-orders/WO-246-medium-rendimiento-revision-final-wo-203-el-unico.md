---
id: "WO-246"
type: "WO"
title: "MEDIUM (rendimiento) — revisión final WO-203: el único pool de Postgres (createPool en main.ts, sin maxConnections, default de 10) sirve tanto el manejo de requests HTTP como toda la persistencia de Hocuspocus (onLoadDocument/onStoreDocument por cada documento colaborativo vivo); bajo muchas sesione"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-006"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/contracts/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/db/*.json","packages/db/*.config.ts","packages/server/src/**","packages/server/tests/**","packages/server/scripts/**","packages/server/*.json","packages/server/Docker[f]ile","packages/server/Dockerfile.dockerignor[e]","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/ui/src/**","packages/ui/tests/**","packages/ui/*.json","packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/testkit/src/**","packages/testkit/package.json","docker/**","docker-compose.yml","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example",".gitignore","README.md",".github/workflows/prdm-sync.yml"]
source_task: "6b1fa849594af772"
tags: ["saas","tenancy","auth","rbac","dashboard"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:12:44.585Z"
completed_at: "2026-09-15T10:48:33.737Z"
resolved_by: ["e6fe962fb6140c41fc77efcb95317496562da1d4"]
blueprint_hashes: {"SDD-006":"91cccdb3cd90181cfcb9b66af72f0851afe979cb7abc5b1ec374b20658ff0ca4"}
---

## Objetivo
MEDIUM (rendimiento) — revisión final WO-203: el único pool de Postgres (createPool en main.ts, sin maxConnections, default de 10) sirve tanto el manejo de requests HTTP como toda la persistencia de Hocuspocus (onLoadDocument/onStoreDocument por cada documento colaborativo vivo); bajo muchas sesiones de collab concurrentes puede agotarse y dejar sin conexiones disponibles a los handlers HTTP normales. Exponer el tamaño del pool por entorno (env.ts) dimensionado a la concurrencia real de collab, con test de que el valor de entorno se respeta

## Contexto
SDD-006 — Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-246`
