---
id: "WO-070"
type: "WO"
title: "Estados de carga, vacío y error con sus tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "4503bb703ef0f8a0"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T19:14:08.000Z"
completed_at: "2026-09-13T19:14:30.948Z"
resolved_by: ["17dc1da01f6cb9b558fab408322099368c1108e6"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
Estados de carga, vacío y error con sus tests

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-070`
