---
id: "WO-047"
type: "WO"
title: "server.ts con bootstrap, validación del header Host y PRDM_WEB_ALLOW_REMOTE, bind a 127.0.0.1, PRDM_WEB_PORT, hook onClose y apagado ordenado por SIGINT/SIGTERM, y sus tests"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "189bd3fcadcfc52b"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
---

## Objetivo
server.ts con bootstrap, validación del header Host y PRDM_WEB_ALLOW_REMOTE, bind a 127.0.0.1, PRDM_WEB_PORT, hook onClose y apagado ordenado por SIGINT/SIGTERM, y sus tests

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-047`
