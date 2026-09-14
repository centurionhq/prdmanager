---
id: "WO-207"
type: "WO"
title: "Corregir la carrera de withRepoLock en la que un heartbeat en vuelo reescribe el lock después de release y lo deja huérfano (deadlock hasta staleAfterMs), serializando y esperando los heartbeats antes de liberar, con test de regresión de adquisiciones secuenciales"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "56aad45c2244567b"
tags: ["saas","engine","documents","workflow"]
---

## Objetivo
Corregir la carrera de withRepoLock en la que un heartbeat en vuelo reescribe el lock después de release y lo deja huérfano (deadlock hasta staleAfterMs), serializando y esperando los heartbeats antes de liberar, con test de regresión de adquisiciones secuenciales

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-207`
