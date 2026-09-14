---
id: "WO-223"
type: "WO"
title: "Revisión de performance (HIGH): blame, restauración y anclaje de comentarios reconstruyen el Y.Doc completo desde cero releyendo todo doc_updates en cada llamada; cachear el Y.Doc reconstruido en proceso por snapshotSeq/maxSeq y solo reproducir la cola desde la última reconstrucción, con un test a e"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "0134c5ec28d1808a"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Revisión de performance (HIGH): blame, restauración y anclaje de comentarios reconstruyen el Y.Doc completo desde cero releyendo todo doc_updates en cada llamada; cachear el Y.Doc reconstruido en proceso por snapshotSeq/maxSeq y solo reproducir la cola desde la última reconstrucción, con un test a escala sintética grande que verifique que la latencia no crece linealmente con el historial completo

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-223`
