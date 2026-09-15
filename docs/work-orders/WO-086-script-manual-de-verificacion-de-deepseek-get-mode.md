---
id: "WO-086"
type: "WO"
title: "Script manual de verificación de DeepSeek (GET /models confirma deepseek-v4-flash y una llamada con tools en streaming), excluido de CI y sin imprimir la clave"
status: "done"
created_at: "2026-09-13"
implements: ["ADR-006"]
impacts_paths: ["packages/server/tests/learning/**","packages/server/scripts/**","packages/server/*.json","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts"]
source_task: "2b5045152af4b32b"
tags: ["architecture-decision","saas","stack"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T20:53:04.809Z"
completed_at: "2026-09-14T20:53:49.157Z"
resolved_by: ["7e2255e1286e754d0cc2f34d1366998484941722"]
blueprint_hashes: {"ADR-006":"7c1798b97241b0318880738cb1f647c68c428180087c9de14fbd36f295505f57"}
---

## Objetivo
Script manual de verificación de DeepSeek (GET /models confirma deepseek-v4-flash y una llamada con tools en streaming), excluido de CI y sin imprimir la clave

## Contexto
ADR-006 — Stack de la plataforma SaaS: Postgres + better-auth + Hocuspocus/Yjs + CodeMirror + DeepSeek; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-086`
