---
id: "WO-074"
type: "WO"
title: "Paso de build de @prdm/web en el workflow de CI (después de que el frontend compile)"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "3721c463a47e6924"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T19:45:33.759Z"
completed_at: "2026-09-13T19:45:37.670Z"
resolved_by: ["d55ac7e722b4a8429b15eb080ea2ede873b50cca"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
Paso de build de @prdm/web en el workflow de CI (después de que el frontend compile)

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-074`
