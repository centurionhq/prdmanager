---
id: "WO-226"
type: "WO"
title: "Revisión de performance (LOW): eliminar el índice redundante en doc_updates.document_id, ya cubierto por el índice único compuesto (document_id, seq), con test de que la migración correspondiente no rompe las consultas existentes"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "a5634857289894f6"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Revisión de performance (LOW): eliminar el índice redundante en doc_updates.document_id, ya cubierto por el índice único compuesto (document_id, seq), con test de que la migración correspondiente no rompe las consultas existentes

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-226`
