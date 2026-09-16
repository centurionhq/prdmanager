---
id: "WO-146"
type: "WO"
title: "Montaje de Hocuspocus en /collab con maxPayload, Origin exacto y sesión validados en el upgrade, onAuthenticate por documento con funciones SECURITY DEFINER y conexión readOnly por rol, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "cc6e76bb66fca021"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T11:14:02.968Z"
completed_at: "2026-09-14T11:26:56.248Z"
resolved_by: ["0b8d125592112a98d002008e15880f9a7bccf2ef"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Montaje de Hocuspocus en /collab con maxPayload, Origin exacto y sesión validados en el upgrade, onAuthenticate por documento con funciones SECURITY DEFINER y conexión readOnly por rol, con tests

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-146`
