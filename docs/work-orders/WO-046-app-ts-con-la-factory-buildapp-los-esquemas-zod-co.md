---
id: "WO-046"
type: "WO"
title: "app.ts con la factory buildApp, los esquemas zod compartidos de params y query, y el harness de integración de la tarea anterior verificando que arranca y cierra limpio"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "c149e7ed78693ceb"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:34:13.006Z"
completed_at: "2026-09-13T17:36:27.519Z"
resolved_by: ["99cce399e2876fbdd3a21002602d41d3771a7b54"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
app.ts con la factory buildApp, los esquemas zod compartidos de params y query, y el harness de integración de la tarea anterior verificando que arranca y cierra limpio

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-046`
