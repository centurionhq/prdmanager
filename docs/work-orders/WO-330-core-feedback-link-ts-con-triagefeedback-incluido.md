---
id: "WO-330"
type: "WO"
title: "Core: `feedback/link.ts` con `triageFeedback`, incluido el caso `collab` (pendiente hasta republicar) y `generated` (inmediato), con tests"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "48819bed7ea1a505"
tags: ["saas","api","lifecycle","drift","feedback"]
---

## Objetivo
Core: `feedback/link.ts` con `triageFeedback`, incluido el caso `collab` (pendiente hasta republicar) y `generated` (inmediato), con tests

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-330`
