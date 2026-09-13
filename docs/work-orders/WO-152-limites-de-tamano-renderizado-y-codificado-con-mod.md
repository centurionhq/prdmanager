---
id: "WO-152"
type: "WO"
title: "Límites de tamaño renderizado y codificado con modo solo lectura al tope, conexiones por usuario y documento y tasa agregada de updates por usuario y por documento con cierre auditado, con tests de cliente abusivo"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "4f6a90d7bd1094ed"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Límites de tamaño renderizado y codificado con modo solo lectura al tope, conexiones por usuario y documento y tasa agregada de updates por usuario y por documento con cierre auditado, con tests de cliente abusivo

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-152`
