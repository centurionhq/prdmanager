---
id: "WO-045"
type: "WO"
title: "errors.ts con ValidationError, NotFoundError, setErrorHandler central y setNotFoundHandler que distingue /api/ (404 JSON) del resto, y sus tests unitarios"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "aabd314da61581d6"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:32:37.569Z"
completed_at: "2026-09-13T17:34:04.516Z"
resolved_by: ["6cf3da99ba8b9b946c78765e3683e7db94085a65"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
errors.ts con ValidationError, NotFoundError, setErrorHandler central y setNotFoundHandler que distingue /api/ (404 JSON) del resto, y sus tests unitarios

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-045`
