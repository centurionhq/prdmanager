---
id: "WO-073"
type: "WO"
title: "README con sección Web UI (incluyendo cómo correr en modo iteración con dos procesos), .env.example con PRDM_WEB_PORT, retiro de \"UI web\" de Fuera del MVP"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "0499f5dcea261bfe"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T19:44:44.015Z"
completed_at: "2026-09-13T19:44:56.927Z"
resolved_by: ["cfb5b2763f0bd25948e2543505240a74d328994e"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
README con sección Web UI (incluyendo cómo correr en modo iteración con dos procesos), .env.example con PRDM_WEB_PORT, retiro de "UI web" de Fuera del MVP

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-073`
