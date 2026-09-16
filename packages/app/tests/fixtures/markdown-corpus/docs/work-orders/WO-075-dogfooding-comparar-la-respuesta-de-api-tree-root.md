---
id: "WO-075"
type: "WO"
title: "Dogfooding: comparar la respuesta de /api/tree?root=PRD-004 contra buildForest usado por la CLI, sync --check en 0, cierre de PRD-004"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "9ae92e055e26e316"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T20:09:13.080Z"
completed_at: "2026-09-13T20:10:20.203Z"
resolved_by: ["5a855e2dce66ee3e97520e65918436c2536ae88e"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
Dogfooding: comparar la respuesta de /api/tree?root=PRD-004 contra buildForest usado por la CLI, sync --check en 0, cierre de PRD-004

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-075`
