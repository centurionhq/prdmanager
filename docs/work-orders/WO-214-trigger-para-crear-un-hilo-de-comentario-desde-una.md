---
id: "WO-214"
type: "WO"
title: "Trigger para crear un hilo de comentario desde una selección de texto en el editor CodeMirror, llamando al endpoint de creación ya existente y refrescando el panel de comentarios, con tests"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "a3e450df7db726ac"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Trigger para crear un hilo de comentario desde una selección de texto en el editor CodeMirror, llamando al endpoint de creación ya existente y refrescando el panel de comentarios, con tests

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-214`
