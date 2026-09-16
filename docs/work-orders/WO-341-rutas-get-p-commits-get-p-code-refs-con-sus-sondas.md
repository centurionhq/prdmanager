---
id: "WO-341"
type: "WO"
title: "Rutas `GET P/commits`, `GET P/code-refs` con sus sondas"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "d302e1167c1fa442"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:07:52.469Z"
completed_at: "2026-09-15T22:57:14.828Z"
resolved_by: ["e5012a15a38408cf21bb77c2b20313922c2bce87"]
blueprint_hashes: {"SDD-012":"d425e24bdec27ebfeed89dd830ca2ba9e8d9b34103adffd8aca1417799ccb1cd"}
---

## Objetivo
Rutas `GET P/commits`, `GET P/code-refs` con sus sondas

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-341`
