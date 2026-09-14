---
id: "WO-222"
type: "WO"
title: "Revisión de performance (HIGH): la cola de escritura durable de doc-update-writer serializa globalmente todos los documentos en una sola cadena de promesas en vez de una por documento, acoplando la latencia de un documento lento a la de todos los demás; cambiar a una cadena por documentId, con test "
status: "done"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "24465a77c1e7f06e"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T18:01:48.334Z"
completed_at: "2026-09-14T18:05:09.053Z"
resolved_by: ["e9b52cb61257278b60dc7f1758f298e5b7950b34"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Revisión de performance (HIGH): la cola de escritura durable de doc-update-writer serializa globalmente todos los documentos en una sola cadena de promesas en vez de una por documento, acoplando la latencia de un documento lento a la de todos los demás; cambiar a una cadena por documentId, con test de que dos documentos distintos no se bloquean entre sí

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-222`
