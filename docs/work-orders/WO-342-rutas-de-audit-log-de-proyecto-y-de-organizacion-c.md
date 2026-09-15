---
id: "WO-342"
type: "WO"
title: "Rutas de audit log de proyecto y de organización con sus sondas y un chequeo de canario en la metadata"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "1f955954ceb1a649"
tags: ["saas","api","lifecycle","drift","feedback"]
---

## Objetivo
Rutas de audit log de proyecto y de organización con sus sondas y un chequeo de canario en la metadata

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-342`
