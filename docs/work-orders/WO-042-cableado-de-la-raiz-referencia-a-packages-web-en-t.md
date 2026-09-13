---
id: "WO-042"
type: "WO"
title: "Cableado de la raíz: referencia a packages/web en tsconfig.json, vitest.config.ts con test.projects (node + jsdom) e includes .ts/.tsx corregidos, tsconfig.test.json con los archivos de packages/web, .gitignore con dist/ test-results/ playwright-report/ blob-report/ playwright/.cache/ de packages/we"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "155a035bb9237046"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:19:05.372Z"
---

## Objetivo
Cableado de la raíz: referencia a packages/web en tsconfig.json, vitest.config.ts con test.projects (node + jsdom) e includes .ts/.tsx corregidos, tsconfig.test.json con los archivos de packages/web, .gitignore con dist/ test-results/ playwright-report/ blob-report/ playwright/.cache/ de packages/web

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-042`
