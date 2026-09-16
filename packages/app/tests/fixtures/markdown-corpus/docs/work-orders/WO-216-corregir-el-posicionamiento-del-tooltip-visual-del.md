---
id: "WO-216"
type: "WO"
title: "Corregir el posicionamiento del tooltip visual del gutter de blame (el aria-label ya es correcto, pero el tooltip no se ve donde corresponde al hacer click), con test de posición relativa al marcador enfocado"
status: "done"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "53935b66fe7601c6"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T16:46:06.647Z"
completed_at: "2026-09-14T16:47:47.461Z"
resolved_by: ["9df4ce5b6aad1f435e5f63fcb429007cc00ca3f4"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Corregir el posicionamiento del tooltip visual del gutter de blame (el aria-label ya es correcto, pero el tooltip no se ve donde corresponde al hacer click), con test de posición relativa al marcador enfocado

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-216`
