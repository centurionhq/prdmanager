---
id: "WO-221"
type: "WO"
title: "Revisión de performance (HIGH): dejar de recodificar el estado completo de Yjs en cada beforeSync para el límite de tamaño; llevar un contador incremental de bytes actualizado solo cuando un batch de doc-update-writer confirma, con test de que el costo no crece con el historial acumulado"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "76fbca95f3c82e02"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Revisión de performance (HIGH): dejar de recodificar el estado completo de Yjs en cada beforeSync para el límite de tamaño; llevar un contador incremental de bytes actualizado solo cuando un batch de doc-update-writer confirma, con test de que el costo no crece con el historial acumulado

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-221`
