---
id: "WO-072"
type: "WO"
title: "E2E con Playwright del recorrido principal (cargar, buscar, seleccionar, ver detalle, ver drift) contra servidor real y Neo4j, corrido localmente (no en CI, ver Tests)"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "be7a8ab183434e0c"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T19:42:56.706Z"
completed_at: "2026-09-13T19:43:14.346Z"
resolved_by: ["854043464f25d4fe0e5f2c982e480a66867c3290"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
E2E con Playwright del recorrido principal (cargar, buscar, seleccionar, ver detalle, ver drift) contra servidor real y Neo4j, corrido localmente (no en CI, ver Tests)

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-072`
