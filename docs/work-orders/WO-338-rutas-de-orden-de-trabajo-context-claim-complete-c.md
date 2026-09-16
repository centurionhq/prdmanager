---
id: "WO-338"
type: "WO"
title: "Rutas de orden de trabajo `context`, `claim`, `complete` con sus sondas, incluido el caso `commit_not_verified_by_ci`"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "e928b0bbbabc75f7"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:07:38.993Z"
completed_at: "2026-09-15T22:56:59.148Z"
resolved_by: ["4f19021d1cbebfa3aaa6b30106c23a536ade5aa6"]
blueprint_hashes: {"SDD-012":"d425e24bdec27ebfeed89dd830ca2ba9e8d9b34103adffd8aca1417799ccb1cd"}
---

## Objetivo
Rutas de orden de trabajo `context`, `claim`, `complete` con sus sondas, incluido el caso `commit_not_verified_by_ci`

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-338`
