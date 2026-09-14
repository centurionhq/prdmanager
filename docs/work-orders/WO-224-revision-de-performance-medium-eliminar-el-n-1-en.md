---
id: "WO-224"
type: "WO"
title: "Revisión de performance (MEDIUM): eliminar el N+1 en el listado de hilos de comentarios (una consulta por hilo para traer sus comentarios); traerlos en una sola consulta agrupada, con test de conteo de queries"
status: "done"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "c87873a6b35389d9"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T18:12:17.082Z"
completed_at: "2026-09-14T18:14:44.333Z"
resolved_by: ["e86b014b051a90ad0a40e08c2e674b08348c21a2"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Revisión de performance (MEDIUM): eliminar el N+1 en el listado de hilos de comentarios (una consulta por hilo para traer sus comentarios); traerlos en una sola consulta agrupada, con test de conteo de queries

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-224`
