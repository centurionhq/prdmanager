---
id: "WO-225"
type: "WO"
title: "Revisión de performance (MEDIUM): el listado y diff de versiones hace SELECT * sin paginar, trayendo yjsState y renderedMarkdown de cada versión aunque el listado no los use; seleccionar solo las columnas necesarias para el listado y paginar, con test"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "d0d971781d670d71"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Revisión de performance (MEDIUM): el listado y diff de versiones hace SELECT * sin paginar, trayendo yjsState y renderedMarkdown de cada versión aunque el listado no los use; seleccionar solo las columnas necesarias para el listado y paginar, con test

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-225`
