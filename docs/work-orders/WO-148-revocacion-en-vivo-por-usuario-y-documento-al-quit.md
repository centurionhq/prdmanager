---
id: "WO-148"
type: "WO"
title: "Revocación en vivo por usuario y documento al quitar miembro, bajar rol, revocar sesión, cambiar contraseña o archivar, y revalidación periódica de sesión y rol, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "9560b1ad3295b607"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T11:41:58.582Z"
completed_at: "2026-09-14T11:42:39.690Z"
resolved_by: ["6c84a228a4c0c6f21ccd3b70fdc1ddc357820f11"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Revocación en vivo por usuario y documento al quitar miembro, bajar rol, revocar sesión, cambiar contraseña o archivar, y revalidación periódica de sesión y rol, con tests

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-148`
