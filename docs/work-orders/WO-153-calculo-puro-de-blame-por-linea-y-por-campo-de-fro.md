---
id: "WO-153"
type: "WO"
title: "Cálculo puro de blame por línea y por campo de frontmatter desde el índice de rangos de doc_updates, con tests de tabla de inserciones, borrados, unión de líneas, undo, restauración y agente"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "13d5b362f3b186dd"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T13:18:32.432Z"
completed_at: "2026-09-14T13:29:11.991Z"
resolved_by: ["e8a4b34ac83a40114eba8a00972bea803e9a514d"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Cálculo puro de blame por línea y por campo de frontmatter desde el índice de rangos de doc_updates, con tests de tabla de inserciones, borrados, unión de líneas, undo, restauración y agente

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-153`
