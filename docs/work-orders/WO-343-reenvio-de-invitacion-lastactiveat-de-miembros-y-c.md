---
id: "WO-343"
type: "WO"
title: "Reenvío de invitación, `lastActiveAt` de miembros y `createdByName` de tokens de CI, con sus sondas"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "d76a901384ca0fc2"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:08:01.944Z"
completed_at: "2026-09-15T22:57:24.608Z"
resolved_by: ["2f29dc31446bc1c2d1f77b7ebdd089f7174ee50b"]
blueprint_hashes: {"SDD-012":"d425e24bdec27ebfeed89dd830ca2ba9e8d9b34103adffd8aca1417799ccb1cd"}
---

## Objetivo
Reenvío de invitación, `lastActiveAt` de miembros y `createdByName` de tokens de CI, con sus sondas

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-343`
