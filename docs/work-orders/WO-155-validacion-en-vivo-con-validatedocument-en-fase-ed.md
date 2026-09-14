---
id: "WO-155"
type: "WO"
title: "Validación en vivo con validateDocument en fase edit tras cada store, scan de publicados cacheado por graph_version y difusión stateless, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "a504118dd996b32a"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T13:37:21.136Z"
completed_at: "2026-09-14T13:45:03.619Z"
resolved_by: ["8b85d951a59a82760553d622f60df3607e9c37dd"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Validación en vivo con validateDocument en fase edit tras cada store, scan de publicados cacheado por graph_version y difusión stateless, con tests

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-155`
