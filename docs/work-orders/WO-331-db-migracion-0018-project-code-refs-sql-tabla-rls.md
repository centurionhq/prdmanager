---
id: "WO-331"
type: "WO"
title: "DB: migración `0018_project_code_refs.sql` (tabla, RLS forzado, FK compuesta, grants, columna `governed_warnings`), con test de catálogo y de aislamiento por organización"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "64ade55ae5910dfb"
tags: ["saas","api","lifecycle","drift","feedback"]
---

## Objetivo
DB: migración `0018_project_code_refs.sql` (tabla, RLS forzado, FK compuesta, grants, columna `governed_warnings`), con test de catálogo y de aislamiento por organización

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-331`
