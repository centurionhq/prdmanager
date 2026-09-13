---
id: "WO-145"
type: "WO"
title: "Persistencia de Hocuspocus con snapshot working_state debounced, gc false y reaplicación de doc_updates al cargar, con tests de dos proveedores en proceso"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "6cf8b1d261be97e5"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Persistencia de Hocuspocus con snapshot working_state debounced, gc false y reaplicación de doc_updates al cargar, con tests de dos proveedores en proceso

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-145`
