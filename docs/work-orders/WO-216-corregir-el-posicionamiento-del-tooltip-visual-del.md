---
id: "WO-216"
type: "WO"
title: "Corregir el posicionamiento del tooltip visual del gutter de blame (el aria-label ya es correcto, pero el tooltip no se ve donde corresponde al hacer click), con test de posición relativa al marcador enfocado"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "53935b66fe7601c6"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Corregir el posicionamiento del tooltip visual del gutter de blame (el aria-label ya es correcto, pero el tooltip no se ve donde corresponde al hacer click), con test de posición relativa al marcador enfocado

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-216`
