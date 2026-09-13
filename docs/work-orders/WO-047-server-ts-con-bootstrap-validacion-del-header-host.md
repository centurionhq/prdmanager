---
id: "WO-047"
type: "WO"
title: "server.ts con bootstrap, validación del header Host y PRDM_WEB_ALLOW_REMOTE, bind a 127.0.0.1, PRDM_WEB_PORT, hook onClose y apagado ordenado por SIGINT/SIGTERM, y sus tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "189bd3fcadcfc52b"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:36:33.681Z"
completed_at: "2026-09-13T17:38:09.425Z"
resolved_by: ["8d4fc4764d248bc71300a53f0b9c66006c67b02b"]
blueprint_hashes: {"SDD-005":"40ffb5aa0ac24b9f000c7583fae084fe23ab3990053927e75e87ed56011b93bd"}
---

## Objetivo
server.ts con bootstrap, validación del header Host y PRDM_WEB_ALLOW_REMOTE, bind a 127.0.0.1, PRDM_WEB_PORT, hook onClose y apagado ordenado por SIGINT/SIGTERM, y sus tests

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-047`
