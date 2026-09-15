---
id: "WO-252"
type: "WO"
title: "HIGH (rendimiento) — revisión final WO-203: el liveYDocCache (reconstruct-ydoc.ts, agregado en la revisión de performance de la Fase 5) solo se evict()a desde persistence.ts's onLoadDocument/afterUnloadDocument — es decir, solo cuando una sesión de Hocuspocus abre o cierra ese documento en vivo. Las"
status: "in_progress"
created_at: "2026-09-15"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "ef4abf4f9cb969ba"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:12:57.679Z"
---

## Objetivo
HIGH (rendimiento) — revisión final WO-203: el liveYDocCache (reconstruct-ydoc.ts, agregado en la revisión de performance de la Fase 5) solo se evict()a desde persistence.ts's onLoadDocument/afterUnloadDocument — es decir, solo cuando una sesión de Hocuspocus abre o cierra ese documento en vivo. Las herramientas del agente (read_document, propose_edit, validate_document) y blame/versiones/comentarios también llaman a reconstructLiveYDoc y crean entradas que, si el documento nunca se abre en el editor en vivo, jamás se liberan: una fuga de memoria acotada solo por "todo documento que algún agente o llamada de solo lectura tocó alguna vez", no por actividad real. Acotar el cache (LRU/TTL/tamaño máximo) en el propio reconstruct-ydoc.ts, con test de que superar el límite evict-ea entradas viejas

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-252`
