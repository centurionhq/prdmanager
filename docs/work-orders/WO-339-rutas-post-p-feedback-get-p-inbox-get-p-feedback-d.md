---
id: "WO-339"
type: "WO"
title: "Rutas `POST P/feedback`, `GET P/inbox`, `GET P/feedback/:docId/candidates`, `POST P/feedback/:docId/triage` con sus sondas"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "d110eb334d04e6ee"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:07:43.448Z"
completed_at: "2026-09-15T22:57:03.802Z"
resolved_by: ["5b48ae95a0a13cc27ae2158045b9142dc3afa032"]
blueprint_hashes: {"SDD-012":"d425e24bdec27ebfeed89dd830ca2ba9e8d9b34103adffd8aca1417799ccb1cd"}
---

## Objetivo
Rutas `POST P/feedback`, `GET P/inbox`, `GET P/feedback/:docId/candidates`, `POST P/feedback/:docId/triage` con sus sondas

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-339`
