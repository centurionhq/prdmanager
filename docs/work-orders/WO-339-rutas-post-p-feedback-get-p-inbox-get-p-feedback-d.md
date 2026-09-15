---
id: "WO-339"
type: "WO"
title: "Rutas `POST P/feedback`, `GET P/inbox`, `GET P/feedback/:docId/candidates`, `POST P/feedback/:docId/triage` con sus sondas"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "d110eb334d04e6ee"
tags: ["saas","api","lifecycle","drift","feedback"]
---

## Objetivo
Rutas `POST P/feedback`, `GET P/inbox`, `GET P/feedback/:docId/candidates`, `POST P/feedback/:docId/triage` con sus sondas

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-339`
