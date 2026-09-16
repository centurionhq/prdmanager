---
id: "WO-144"
type: "WO"
title: "Scaffold de packages/collab (yjs 13.6.32, y-protocols 1.0.7) con el esquema del Y.Doc (raíces fm y body, tipos permitidos) y proyección pura a título, campos y cuerpo, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "0c45b8a0ef3367de"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T11:01:33.897Z"
completed_at: "2026-09-14T11:04:24.455Z"
resolved_by: ["8523aad9bdd191a7b04f757035a26c3a88f5832d"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Scaffold de packages/collab (yjs 13.6.32, y-protocols 1.0.7) con el esquema del Y.Doc (raíces fm y body, tipos permitidos) y proyección pura a título, campos y cuerpo, con tests

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-144`
