---
id: "WO-327"
type: "WO"
title: "Contratos: `work-orders.ts`, `feedback.ts`, `metrics.ts`, `search.ts`, `audit.ts`, extensión de miembros (`lastActiveAt`) y de tokens de CI (`createdByName`), con tests"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "a0690d56e4c22f21"
tags: ["saas","api","lifecycle","drift","feedback"]
---

## Objetivo
Contratos: `work-orders.ts`, `feedback.ts`, `metrics.ts`, `search.ts`, `audit.ts`, extensión de miembros (`lastActiveAt`) y de tokens de CI (`createdByName`), con tests

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-327`
