---
id: "WO-214"
type: "WO"
title: "Trigger para crear un hilo de comentario desde una selección de texto en el editor CodeMirror, llamando al endpoint de creación ya existente y refrescando el panel de comentarios, con tests"
status: "done"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "a3e450df7db726ac"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T16:02:20.947Z"
completed_at: "2026-09-14T16:07:57.296Z"
resolved_by: ["c1f60f553d51fd718deffffe4056a59db87bacca"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Trigger para crear un hilo de comentario desde una selección de texto en el editor CodeMirror, llamando al endpoint de creación ya existente y refrescando el panel de comentarios, con tests

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-214`
