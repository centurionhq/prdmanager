---
id: "WO-056"
type: "WO"
title: "Servir el bundle con @fastify/static desde dist/client, fallback SPA, cabeceras de seguridad de producción, y tests de fallback SPA y de path traversal"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "3589889a8ad0ec83"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T18:24:11.222Z"
completed_at: "2026-09-13T18:27:10.998Z"
resolved_by: ["ea036113c50238411c85903e831db544f02a9a03"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
Servir el bundle con @fastify/static desde dist/client, fallback SPA, cabeceras de seguridad de producción, y tests de fallback SPA y de path traversal

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-056`
