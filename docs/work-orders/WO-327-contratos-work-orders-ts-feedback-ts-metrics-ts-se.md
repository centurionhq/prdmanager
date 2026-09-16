---
id: "WO-327"
type: "WO"
title: "Contratos: `work-orders.ts`, `feedback.ts`, `metrics.ts`, `search.ts`, `audit.ts`, extensión de miembros (`lastActiveAt`) y de tokens de CI (`createdByName`), con tests"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "a0690d56e4c22f21"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T21:02:26.997Z"
completed_at: "2026-09-15T21:52:42.469Z"
resolved_by: ["c5d02b734f402295759418c9e67e3a31601c0c7b"]
blueprint_hashes: {"SDD-012":"d425e24bdec27ebfeed89dd830ca2ba9e8d9b34103adffd8aca1417799ccb1cd"}
---

## Objetivo
Contratos: `work-orders.ts`, `feedback.ts`, `metrics.ts`, `search.ts`, `audit.ts`, extensión de miembros (`lastActiveAt`) y de tokens de CI (`createdByName`), con tests

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-327`
