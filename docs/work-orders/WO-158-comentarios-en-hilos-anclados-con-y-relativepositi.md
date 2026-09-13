---
id: "WO-158"
type: "WO"
title: "Comentarios en hilos anclados con Y.RelativePosition y texto citado calculado por el servidor (responder, resolver, reabrir, borrar), con RLS, permisos y aviso stateless, con tests"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "50ce0363b1c9c67b"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Comentarios en hilos anclados con Y.RelativePosition y texto citado calculado por el servidor (responder, resolver, reabrir, borrar), con RLS, permisos y aviso stateless, con tests

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-158`
