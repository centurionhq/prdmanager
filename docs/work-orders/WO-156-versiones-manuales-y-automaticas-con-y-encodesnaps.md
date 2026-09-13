---
id: "WO-156"
type: "WO"
title: "Versiones manuales y automáticas con Y.encodeSnapshot, contribuyentes y diff por líneas, con tests"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "b23c0783cdaae626"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Versiones manuales y automáticas con Y.encodeSnapshot, contribuyentes y diff por líneas, con tests

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-156`
