---
id: "WO-219"
type: "WO"
title: "Revisión de seguridad #2 (HIGH): límite de tasa por usuario y por documento en la creación y respuesta de hilos de comentarios (hoy solo hay un límite de tamaño de cuerpo, no de volumen), con test de un cliente abusivo"
status: "done"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "0f26180f32b9d419"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T17:10:09.895Z"
completed_at: "2026-09-14T17:15:53.372Z"
resolved_by: ["29c67da96feede2c6bfa0e41824e844adae4e06b"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Revisión de seguridad #2 (HIGH): límite de tasa por usuario y por documento en la creación y respuesta de hilos de comentarios (hoy solo hay un límite de tamaño de cuerpo, no de volumen), con test de un cliente abusivo

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-219`
