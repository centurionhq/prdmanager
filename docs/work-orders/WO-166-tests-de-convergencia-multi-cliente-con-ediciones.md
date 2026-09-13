---
id: "WO-166"
type: "WO"
title: "Tests de convergencia multi-cliente con ediciones concurrentes, reconexión offline, reinicio del servidor y blame correcto, esperando eventos y sin aserciones de tiempo de reloj"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "ff1d6ecc426f3e8b"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Tests de convergencia multi-cliente con ediciones concurrentes, reconexión offline, reinicio del servidor y blame correcto, esperando eventos y sin aserciones de tiempo de reloj

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-166`
